import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { handlers, send, closedSend, openExternal } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>(),
  send: vi.fn(),
  openExternal: vi.fn(async () => {}),
  closedSend: vi.fn(),
}))
vi.mock('electron', () => ({
  shell: { openExternal },
  ipcMain: {
    handle: (name: string, fn: (event: unknown, input?: unknown) => Promise<unknown>) =>
      handlers.set(name, fn),
  },
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
      { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: closedSend } },
    ],
  },
}))
import { registerResourcesIpc } from './resources.ipc'
import { ResourceManager } from '../resources/ResourceManager'
import { ModelRegistry } from '../resources/ModelRegistry'
import { ModelDownloader } from '../resources/ModelDownloader'
import { ModelDefinitionSchema } from '../../shared/modelManifest.schema'
const model = ModelDefinitionSchema.parse({
  id: 'transcription-default',
  capability: 'transcription',
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  expectedFiles: ['model.bin'],
  files: [{ path: 'model.bin', size: 1, sha256: 'a'.repeat(64) }],
  license: 'MIT',
  access: 'public',
  profiles: [],
  supportedLanguages: ['zh', 'en'],
})
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  handlers.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
it('validates targets, reads without traffic, and cancellation does not start preparation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resource-ipc-'))
  dirs.push(dir)
  const fetcher = vi.fn<typeof fetch>()
  registerResourcesIpc(
    new ResourceManager([model], new ModelRegistry(dir), new ModelDownloader(fetcher)),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await handlers.get('resources:prepare')!({}, 'arbitrary-model')).toMatchObject({
    ok: false,
    error: { code: 'invalid-request' },
  })
  expect(await handlers.get('resources:get')!({})).toMatchObject({
    ok: true,
    value: { baseReady: false, resources: [{ status: 'missing' }] },
  })
  expect(await handlers.get('resources:cancel')!({})).toMatchObject({
    ok: true,
    value: { baseReady: false },
  })
  expect(fetcher).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledWith(
    'resources:changed',
    expect.objectContaining({ baseReady: false }),
  )
  expect(closedSend).not.toHaveBeenCalled()
})
it('fails runtime preflight before requesting model bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resource-ipc-'))
  dirs.push(dir)
  const fetcher = vi.fn<typeof fetch>()
  const validate = Object.assign(async () => {}, {
    preflight: async () => {
      throw new Error('runtime unavailable')
    },
  })
  const manager = new ResourceManager(
    [model],
    new ModelRegistry(dir),
    new ModelDownloader(fetcher),
    validate,
  )
  registerResourcesIpc(manager)
  const failed = new Promise<void>((resolve) => {
    const off = manager.subscribe((s) => {
      if (s.resources[0].status === 'failed') {
        off()
        resolve()
      }
    })
  })
  expect(await handlers.get('resources:prepare')!({}, 'base')).toMatchObject({ ok: true })
  await failed
  expect(await handlers.get('resources:get')!({})).toMatchObject({
    ok: true,
    value: { resources: [{ status: 'failed', error: 'runtime-unavailable' }] },
  })
  expect(fetcher).not.toHaveBeenCalled()
})

it('opens only approved installation guides, never arbitrary renderer URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guide-test-'))
  try {
    registerResourcesIpc(new ResourceManager([], new ModelRegistry(directory)))
    expect(await handlers.get('resources:open-guide')!({}, 'python')).toMatchObject({ ok: true })
    expect(openExternal).toHaveBeenCalledWith(
      'https://docs.astral.sh/uv/getting-started/installation/',
    )
    openExternal.mockClear()
    expect(await handlers.get('resources:open-guide')!({}, 'https://example.com')).toMatchObject({
      ok: false,
    })
    expect(openExternal).not.toHaveBeenCalled()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
