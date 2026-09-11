import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) }
})
import { AppPreferencesStore } from './AppPreferencesStore'

let directory: string
let path: string
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'podcut-app-preferences-'))
  path = join(directory, 'app-preferences.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

test('missing preferences resolve system languages without creating a file', async () => {
  const store = new AppPreferencesStore(path, () => ['zh-TW', 'zh-Hans'])
  expect(store.getSnapshot()).toEqual({
    preference: 'system',
    resolvedLocale: 'en',
    revision: 0,
    warning: null,
  })
  expect(await store.read()).toEqual({
    preference: 'system',
    resolvedLocale: 'zh-CN',
    revision: 0,
    warning: null,
  })
  await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

test.each([
  '{broken',
  JSON.stringify({ version: 20, localePreference: 'zh-CN' }),
  JSON.stringify({ version: 1, localePreference: 'fr' }),
])('invalid preferences warn without rewriting the input', async (raw) => {
  await fs.writeFile(path, raw)
  expect(await new AppPreferencesStore(path, () => ['en-US']).read()).toEqual({
    preference: 'system',
    resolvedLocale: 'en',
    revision: 0,
    warning: 'invalid-preferences',
  })
  expect(await fs.readFile(path, 'utf8')).toBe(raw)
})

test('persists only version and preference; restart resolves system afresh and resets revision', async () => {
  let languages = ['en-US']
  const store = new AppPreferencesStore(path, () => languages)
  await store.setLocale('zh-CN')
  languages = ['zh-SG']
  expect(await store.setLocale('system')).toEqual({
    preference: 'system',
    resolvedLocale: 'zh-CN',
    revision: 2,
    warning: null,
  })
  expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({
    version: 1,
    localePreference: 'system',
  })
  expect(await new AppPreferencesStore(path, () => ['en-GB']).read()).toEqual({
    preference: 'system',
    resolvedLocale: 'en',
    revision: 0,
    warning: null,
  })
})

test('serializes concurrent writes and reads observe admitted updates', async () => {
  const store = new AppPreferencesStore(path, () => ['en-US'])
  const first = store.setLocale('zh-CN')
  const second = store.setLocale('en')
  const read = store.read()
  expect(await first).toEqual({
    preference: 'zh-CN',
    resolvedLocale: 'zh-CN',
    revision: 1,
    warning: null,
  })
  expect(await second).toEqual({
    preference: 'en',
    resolvedLocale: 'en',
    revision: 2,
    warning: null,
  })
  expect(await read).toEqual(await second)
  expect((await new AppPreferencesStore(path, () => []).read()).preference).toBe('en')
  expect(await fs.readdir(directory)).toEqual(['app-preferences.json'])
})

test('a failed atomic rename preserves the committed snapshot and file, cleans up, and allows retry', async () => {
  const store = new AppPreferencesStore(path, () => ['en'])
  const committed = await store.setLocale('en')
  vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(store.setLocale('zh-CN')).rejects.toMatchObject({ code: 'EACCES' })
  expect(store.getSnapshot()).toEqual(committed)
  expect(await store.read()).toEqual(committed)
  expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({
    version: 1,
    localePreference: 'en',
  })
  expect(await fs.readdir(directory)).toEqual(['app-preferences.json'])
  expect((await store.setLocale('zh-CN')).revision).toBe(2)
})

test('read errors remain observable and retry can hydrate without poisoning the queue', async () => {
  const store = new AppPreferencesStore(path, () => ['zh-CN'])
  vi.mocked(fs.readFile).mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'EACCES' }),
  )
  await expect(store.read()).rejects.toMatchObject({ code: 'EACCES' })
  expect(store.getSnapshot().resolvedLocale).toBe('en')
  expect((await store.read()).resolvedLocale).toBe('zh-CN')
})

test('snapshot callers cannot mutate committed preferences and invalid writes are rejected', async () => {
  const store = new AppPreferencesStore(path, () => ['en'])
  const result = await store.setLocale('zh-CN')
  result.preference = 'en'
  store.getSnapshot().revision = 100
  expect(store.getSnapshot()).toEqual({
    preference: 'zh-CN',
    resolvedLocale: 'zh-CN',
    revision: 1,
    warning: null,
  })
  await expect(store.setLocale('fr' as 'en')).rejects.toThrow()
  expect((await store.read()).revision).toBe(1)
})

test('stores write exclusively to their active userData location', async () => {
  const normalPath = join(directory, 'normal-userData', 'app-preferences.json')
  const harnessPath = join(directory, 'harness-userData', 'app-preferences.json')
  await new AppPreferencesStore(normalPath, () => ['en']).setLocale('en')
  await new AppPreferencesStore(harnessPath, () => ['en']).setLocale('zh-CN')
  expect((await new AppPreferencesStore(normalPath, () => []).read()).preference).toBe('en')
  expect((await new AppPreferencesStore(harnessPath, () => []).read()).preference).toBe('zh-CN')
})
