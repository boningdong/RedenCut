import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { handlers, send, destroyedSend, secondSend } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>(),
  send: vi.fn(),
  destroyedSend: vi.fn(),
  secondSend: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (event: unknown, input?: unknown) => Promise<unknown>) =>
      handlers.set(name, fn),
  },
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: secondSend } },
      { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: destroyedSend } },
    ],
  },
}))
import { registerAppPreferencesIpc } from './appPreferences.ipc'
import { AppPreferencesStore } from '../preferences/AppPreferencesStore'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
  handlers.clear()
  vi.clearAllMocks()
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'redencut-app-preferences-ipc-'))
  directories.push(directory)
  const path = join(directory, 'app-preferences.json')
  const store = new AppPreferencesStore(path, () => ['en'])
  const sink = vi.fn()
  registerAppPreferencesIpc(store, sink)
  return {
    path,
    store,
    sink,
    get: () => handlers.get('app-preferences:get')!({}),
    set: (input: unknown) => handlers.get('app-preferences:set-locale')!({}, input),
  }
}

test('gets preferences and broadcasts ordered snapshots exactly matching successful responses', async () => {
  const { get, set } = await setup()
  expect(await get()).toEqual({
    ok: true,
    value: {
      themeId: 'dark',
      themePreferenceSet: false,
      textEditingEnabled: true,
      speakerRecognitionEnabled: true,
      onboardingDisposition: 'pending',
      preference: 'system',
      resolvedLocale: 'en',
      revision: 0,
      warning: null,
    },
  })
  const responses = await Promise.all([set('zh-CN'), set('en')])
  expect(responses).toEqual([
    {
      ok: true,
      value: {
        themeId: 'dark',
        themePreferenceSet: false,
        textEditingEnabled: true,
        speakerRecognitionEnabled: true,
        onboardingDisposition: 'pending',
        preference: 'zh-CN',
        resolvedLocale: 'zh-CN',
        revision: 1,
        warning: null,
      },
    },
    {
      ok: true,
      value: {
        themeId: 'dark',
        themePreferenceSet: false,
        textEditingEnabled: true,
        speakerRecognitionEnabled: true,
        onboardingDisposition: 'pending',
        preference: 'en',
        resolvedLocale: 'en',
        revision: 2,
        warning: null,
      },
    },
  ])
  expect(send.mock.calls).toEqual(
    responses.map((response) => [
      'app-preferences:changed',
      (response as { value: unknown }).value,
    ]),
  )
  expect(destroyedSend).not.toHaveBeenCalled()
})

test.each(['fr', null, {}, 1, 'EN'])(
  'rejects invalid preference %j without saving or publishing',
  async (input) => {
    const { set, store } = await setup()
    expect(await set(input)).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(send).not.toHaveBeenCalled()
    expect(store.getSnapshot().revision).toBe(0)
  },
)

test('failed writes publish no event, preserve state and redact filesystem diagnostics', async () => {
  const { set, get, path, sink } = await setup()
  await set('en')
  send.mockClear()
  await rm(path)
  await mkdir(path)
  const response = await set('zh-CN')
  expect(response).toMatchObject({ ok: false, error: { code: 'operation-failed' } })
  expect(JSON.stringify(response)).not.toContain(path)
  expect(send).not.toHaveBeenCalled()
  expect(sink).toHaveBeenCalled()
  expect(await get()).toMatchObject({
    ok: true,
    value: {
      themeId: 'dark',
      themePreferenceSet: false,
      textEditingEnabled: true,
      speakerRecognitionEnabled: true,
      onboardingDisposition: 'pending',
      preference: 'en',
      revision: 1,
    },
  })
})

test('a closing window does not reject a committed preference or block other subscribers', async () => {
  const { set, store, sink } = await setup()
  send.mockImplementationOnce(() => {
    throw new Error('WebContents destroyed during send')
  })
  const response = await set('zh-CN')
  expect(response).toEqual({
    ok: true,
    value: {
      themeId: 'dark',
      themePreferenceSet: false,
      textEditingEnabled: true,
      speakerRecognitionEnabled: true,
      onboardingDisposition: 'pending',
      preference: 'zh-CN',
      resolvedLocale: 'zh-CN',
      revision: 1,
      warning: null,
    },
  })
  expect(secondSend).toHaveBeenCalledWith('app-preferences:changed', store.getSnapshot())
  expect(sink).toHaveBeenCalled()
})
