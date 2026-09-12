import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>(),
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (event: unknown, input?: unknown) => Promise<unknown>) =>
      handlers.set(name, fn),
  },
}))
import { registerWorkspaceLayoutIpc } from './workspaceLayout.ipc'
import { WorkspaceLayoutStore } from '../preferences/WorkspaceLayoutStore'
import { DEFAULT_WORKSPACE_LAYOUT as defaults } from '../../shared/workspaceLayout.types'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  handlers.clear()
})
test('gets and sets without a project, rejects invalid data, and maps filesystem errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'riffcut-layout-ipc-'))
  directories.push(dir)
  const path = join(dir, 'prefs.json'),
    store = new WorkspaceLayoutStore(path),
    sink = vi.fn()
  registerWorkspaceLayoutIpc(store, sink)
  const get = () => handlers.get('workspace-layout:get')!({})
  const set = (input: unknown) => handlers.get('workspace-layout:set')!({}, input)
  expect(await get()).toEqual({ ok: true, value: { layout: defaults, warning: null } })
  expect(await set({ ...defaults, transportPosition: 'top' })).toEqual({
    ok: true,
    value: { ...defaults, transportPosition: 'top' },
  })
  expect(await set({ ...defaults, transcriptRatio: Infinity })).toMatchObject({
    ok: false,
    error: { code: 'invalid-request' },
  })
  await rm(path)
  await mkdir(path)
  expect(await get()).toMatchObject({ ok: false, error: { code: 'operation-failed' } })
  expect(await set(defaults)).toMatchObject({ ok: false, error: { code: 'operation-failed' } })
  expect(sink).toHaveBeenCalled()
})
