// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { AppPreferencesSnapshot } from '@shared/appPreferences.types'
import type { IElectronAPI } from '@shared/ipc.types'
import { createLocaleStore } from './locale.store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const english: AppPreferencesSnapshot = {
  preference: 'system',
  resolvedLocale: 'en',
  revision: 0,
  warning: null,
  themeId: 'dark',
  whisperModelId: 'transcription-default',
  themePreferenceSet: true,
  textEditingEnabled: true,
  speakerRecognitionEnabled: true,
  onboardingDisposition: 'pending',
}
const chinese: AppPreferencesSnapshot = {
  preference: 'zh-CN',
  resolvedLocale: 'zh-CN',
  revision: 1,
  warning: null,
  themeId: 'dark',
  whisperModelId: 'transcription-default',
  themePreferenceSet: true,
  textEditingEnabled: true,
  speakerRecognitionEnabled: true,
  onboardingDisposition: 'pending',
}
function fixture() {
  const read = deferred<AppPreferencesSnapshot>()
  const events: string[] = []
  let listener!: (snapshot: AppPreferencesSnapshot) => void
  const unsubscribe = vi.fn()
  const api: IElectronAPI['appPreferences'] = {
    get: vi.fn(() => {
      events.push('get')
      return read.promise
    }),
    setLocale: vi.fn(),
    setTheme: vi.fn(),
    migrateTheme: vi.fn(),
    setFeaturePreferences: vi.fn(),
    setOnboardingDisposition: vi.fn(),
    onChanged: vi.fn((callback) => {
      events.push('subscribe')
      listener = callback
      return unsubscribe
    }),
  }
  const store = createLocaleStore(() => api)
  return {
    store,
    api,
    read,
    events,
    unsubscribe,
    emit: (snapshot: AppPreferencesSnapshot) => listener(snapshot),
  }
}
describe('locale preferences', () => {
  it('subscribes before reading and ignores a hydration response older than an event', async () => {
    const f = fixture()
    const hydration = f.store.getState().hydrate()
    expect(f.events).toEqual(['subscribe', 'get'])
    f.emit(chinese)
    f.read.resolve(english)
    await hydration
    expect(f.store.getState()).toMatchObject({ ...chinese, hydrated: true })
    f.emit(english)
    expect(f.store.getState().resolvedLocale).toBe('zh-CN')
    f.store.getState().dispose()
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('serializes rapid choices and keeps language committed until persistence succeeds', async () => {
    const f = fixture()
    const first = deferred<AppPreferencesSnapshot>()
    const second = deferred<AppPreferencesSnapshot>()
    vi.mocked(f.api.setLocale)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const a = f.store.getState().setLocale('zh-CN')
    const b = f.store.getState().setLocale('en')
    await Promise.resolve()
    expect(f.api.setLocale).toHaveBeenCalledTimes(1)
    expect(f.store.getState()).toMatchObject({ resolvedLocale: 'en', pending: true })
    first.resolve(chinese)
    await a
    expect(f.store.getState()).toMatchObject({ resolvedLocale: 'zh-CN', pending: true })
    second.resolve({ ...english, preference: 'en', revision: 2 })
    await b
    expect(f.store.getState()).toMatchObject({ preference: 'en', revision: 2, pending: false })
  })
  it('keeps the prior committed snapshot on rejected saves without exposing diagnostics', async () => {
    const f = fixture()
    vi.mocked(f.api.setLocale).mockRejectedValue(new Error('/private/secret write error'))
    await f.store.getState().setLocale('zh-CN')
    expect(f.store.getState()).toMatchObject({
      resolvedLocale: 'en',
      pending: false,
      error: { reason: 'save-preferences' },
    })
  })
  it('recovers in English on read failure and supports retry', async () => {
    const f = fixture()
    const hydration = f.store.getState().hydrate()
    f.read.reject(new Error('/private/secret'))
    await hydration
    expect(f.store.getState()).toMatchObject({
      resolvedLocale: 'en',
      hydrated: true,
      error: { reason: 'load-preferences' },
    })
    vi.mocked(f.api.get).mockResolvedValue(chinese)
    await f.store.getState().hydrate()
    expect(f.store.getState()).toMatchObject({ ...chinese, error: null })
    expect(f.api.onChanged).toHaveBeenCalledOnce()
  })
  it('does not overwrite an event on save response or late read failure', async () => {
    const f = fixture()
    const hydration = f.store.getState().hydrate()
    vi.mocked(f.api.setLocale).mockResolvedValue(chinese)
    f.emit({ ...english, revision: 2 })
    await f.store.getState().setLocale('zh-CN')
    f.read.reject(new Error('stale read failed'))
    await hydration
    expect(f.store.getState()).toMatchObject({ resolvedLocale: 'en', revision: 2, error: null })
  })
  it('ignores hydration and events after teardown', async () => {
    const f = fixture()
    const hydration = f.store.getState().hydrate()
    f.store.getState().dispose()
    f.emit(chinese)
    f.read.resolve(chinese)
    await hydration
    expect(f.store.getState().resolvedLocale).toBe('en')
  })
})

it('migrates only a valid legacy theme when main has not saved one', async () => {
  const f = fixture()
  localStorage.setItem('theme', 'light')
  vi.mocked(f.api.migrateTheme).mockResolvedValue({
    ...english,
    themeId: 'light',
    whisperModelId: 'transcription-default',
    themePreferenceSet: true,
    revision: 1,
  })
  const hydration = f.store.getState().hydrate()
  f.read.resolve({ ...english, themePreferenceSet: false })
  await hydration
  expect(f.api.migrateTheme).toHaveBeenCalledWith('light')
  expect(f.store.getState().themeId).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('theme')).toBeNull()
  f.store.getState().dispose()
})
it('shares serialization and revision protection across theme and feature writes', async () => {
  const f = fixture()
  const first = deferred<AppPreferencesSnapshot>()
  vi.mocked(f.api.setTheme).mockReturnValue(first.promise)
  vi.mocked(f.api.setFeaturePreferences).mockResolvedValue({
    ...english,
    themeId: 'light',
    speakerRecognitionEnabled: false,
    revision: 2,
  })
  const theme = f.store.getState().setTheme('light')
  const feature = f.store.getState().setFeaturePreferences({ speakerRecognitionEnabled: false })
  await Promise.resolve()
  expect(f.api.setFeaturePreferences).not.toHaveBeenCalled()
  first.resolve({ ...english, themeId: 'light', revision: 1 })
  await theme
  await feature
  expect(f.store.getState()).toMatchObject({
    themeId: 'light',
    speakerRecognitionEnabled: false,
    revision: 2,
    pending: false,
  })
})
it('retains a legacy theme and surfaces a failed migration for retry', async () => {
  const f = fixture()
  localStorage.setItem('theme', 'light')
  vi.mocked(f.api.migrateTheme).mockRejectedValue(new Error('disk unavailable'))
  const hydration = f.store.getState().hydrate()
  f.read.resolve({ ...english, themePreferenceSet: false })
  await hydration
  expect(f.store.getState().error).toEqual({ reason: 'save-preferences' })
  expect(localStorage.getItem('theme')).toBe('light')
  localStorage.removeItem('theme')
  f.store.getState().dispose()
})
