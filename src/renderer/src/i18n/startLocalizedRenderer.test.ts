// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { AppPreferencesSnapshot } from '@shared/appPreferences.types'
import { startLocalizedRenderer } from './startLocalizedRenderer'
import { useLocaleStore } from '../stores/locale.store'
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  useLocaleStore.getState().dispose()
})
function setup() {
  useLocaleStore.setState({ resolvedLocale: 'en', revision: -1, hydrated: false, error: null })
  let resolve!: (snapshot: AppPreferencesSnapshot) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<AppPreferencesSnapshot>((yes, no) => {
    resolve = yes
    reject = no
  })
  let listener!: (snapshot: AppPreferencesSnapshot) => void
  const unsubscribe = vi.fn()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      appPreferences: {
        get: () => promise,
        onChanged: (callback: typeof listener) => {
          listener = callback
          return unsubscribe
        },
      },
    },
  })
  return {
    resolve,
    reject,
    unsubscribe,
    emit: (snapshot: AppPreferencesSnapshot) => listener(snapshot),
  }
}
const chinese: AppPreferencesSnapshot = {
  preference: 'zh-CN',
  resolvedLocale: 'zh-CN',
  revision: 0,
  warning: null,
  themeId: 'dark',
  whisperModelId: 'transcription-default',
  themePreferenceSet: true,
  textEditingEnabled: true,
  speakerRecognitionEnabled: true,
  onboardingDisposition: 'pending',
}
it('hydrates before rendering and keeps the document language synchronized', async () => {
  const api = setup()
  const render = vi.fn()
  dispose = startLocalizedRenderer(render)
  expect(render).not.toHaveBeenCalled()
  api.resolve(chinese)
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce())
  expect(document.documentElement.lang).toBe('zh-CN')
  api.emit({ ...chinese, preference: 'en', resolvedLocale: 'en', revision: 1 })
  expect(document.documentElement.lang).toBe('en')
  expect(render).toHaveBeenCalledOnce()
})
it('renders recoverable English after a failed read', async () => {
  const api = setup()
  const render = vi.fn()
  dispose = startLocalizedRenderer(render)
  api.reject(new Error('/private/config'))
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce())
  expect(document.documentElement.lang).toBe('en')
  expect(useLocaleStore.getState().error).toEqual({ reason: 'load-preferences' })
})
it('unsubscribes at page teardown and prevents a pending startup render', async () => {
  const api = setup()
  const render = vi.fn()
  dispose = startLocalizedRenderer(render)
  window.dispatchEvent(new Event('beforeunload'))
  expect(api.unsubscribe).toHaveBeenCalledOnce()
  api.resolve(chinese)
  await Promise.resolve()
  await Promise.resolve()
  expect(render).not.toHaveBeenCalled()
  expect(document.documentElement.lang).toBe('en')
})
