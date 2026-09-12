vi.mock('node:crypto', () => ({ randomUUID: () => 'test-unique-token' }))
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) }
})
import { WorkspaceLayoutStore } from './WorkspaceLayoutStore'
import { DEFAULT_WORKSPACE_LAYOUT as defaults } from '../../shared/workspaceLayout.types'

let directory: string
let path: string
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'riffcut-layout-'))
  path = join(directory, 'workspace-layout.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})
test('missing preferences are defaults without creating a file', async () => {
  expect(await new WorkspaceLayoutStore(path).read()).toEqual({ layout: defaults, warning: null })
  await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})
test.each([
  '{broken',
  JSON.stringify({ version: 20 }),
  JSON.stringify({ version: 1, contentOrder: ['audio'], transcriptRatio: 0.7 }),
])('reads recoverable input without overwriting it', async (raw) => {
  await fs.writeFile(path, raw)
  const result = await new WorkspaceLayoutStore(path).read()
  expect(result.warning).not.toBeNull()
  expect(await fs.readFile(path, 'utf8')).toBe(raw)
})
test('serializes writes and reads queued results; snapshots caller values', async () => {
  const store = new WorkspaceLayoutStore(path)
  const first = { ...defaults, transcriptRatio: 0.7 }
  const latest = { ...defaults, transportPosition: 'top' as 'top' | 'bottom' }
  const writes = [store.write(first), store.write(latest)]
  latest.transportPosition = 'bottom'
  const read = store.read()
  await Promise.all(writes)
  expect((await read).layout.transportPosition).toBe('top')
  expect((await new WorkspaceLayoutStore(path).read()).layout.transportPosition).toBe('top')
  expect(await fs.readdir(directory)).toEqual(['workspace-layout.json'])
})
test('rename failure preserves old data, removes temporary file, and does not poison queue', async () => {
  const store = new WorkspaceLayoutStore(path)
  await store.write(defaults)
  vi.mocked(fs.rename).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(store.write({ ...defaults, transcriptRatio: 0.8 })).rejects.toMatchObject({
    code: 'EACCES',
  })
  expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual(defaults)
  expect(await fs.readdir(directory)).toEqual(['workspace-layout.json'])
  await store.write({ ...defaults, transcriptRatio: 0.7 })
  expect((await store.read()).layout.transcriptRatio).toBe(0.7)
})
test('read errors propagate and invalid writes do not replace preferences', async () => {
  const store = new WorkspaceLayoutStore(path)
  await store.write(defaults)
  await expect(store.write({ ...defaults, transcriptRatio: NaN })).rejects.toThrow()
  vi.mocked(fs.readFile).mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'EACCES' }),
  )
  await expect(store.read()).rejects.toMatchObject({ code: 'EACCES' })
  expect((await store.read()).layout).toEqual(defaults)
})

test('exclusive-create collision preserves the unowned file and queue recovers', async () => {
  const store = new WorkspaceLayoutStore(path)
  const temporary = join(directory, '.workspace-layout.json.test-unique-token.tmp')
  await fs.writeFile(temporary, 'belongs to another operation')
  await expect(store.write(defaults)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await fs.readFile(temporary, 'utf8')).toBe('belongs to another operation')
  await fs.rm(temporary)
  await store.write(defaults)
  expect((await store.read()).layout).toEqual(defaults)
})
