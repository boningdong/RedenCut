import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ModelRegistry } from './ModelRegistry'
import { ResourceManager } from './ResourceManager'
import { ModelDownloader } from './ModelDownloader'
import { managedModelLocation } from './ManagedModelLocation'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
const bytes = Buffer.from('verified offline model')
const model: ModelDefinition = {
  id: 'diarization-default',
  capability: 'diarization',
  repository: 'owner/model',
  revision: 'a'.repeat(40),
  files: [
    {
      path: 'model.bin',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
  expectedFiles: ['model.bin'],
  license: 'CC-BY-4.0',
  access: 'gated-auto',
  profiles: [],
  supportedLanguages: ['en'],
}
const dirs: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'managed-model-'))
  dirs.push(root)
  const managed = {
    root: join(root, 'managed'),
    displayRoot: '.runtime/models',
    source: 'development-runtime' as const,
  }
  const registry = new ModelRegistry(root, managed)
  const installed = join(managed.root, 'diarization', model.revision)
  const install = async () => {
    await mkdir(installed, { recursive: true })
    await writeFile(join(installed, 'model.bin'), bytes)
    await writeFile(join(installed, 'installation.json'), JSON.stringify(model))
  }
  return { registry, installed, install }
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
it('ignores development overrides in packaged builds and exposes relative dev paths', () => {
  expect(
    managedModelLocation({
      packaged: true,
      resourcesPath: '/app/resources',
      appPath: '/project',
      env: { REDENCUT_MODELS_ROOT: '/override' },
    }),
  ).toMatchObject({ root: '/app/resources/models', source: 'bundled' })
  expect(
    managedModelLocation({ packaged: false, resourcesPath: '', appPath: '/project', env: {} }),
  ).toMatchObject({ root: '/project/.runtime/models', displayRoot: '.runtime/models' })
  expect(
    managedModelLocation({
      packaged: false,
      resourcesPath: '',
      appPath: '/project',
      env: { REDENCUT_MODELS_ROOT: '/opt/models' },
    }).root,
  ).toBe('/opt/models')
})
it('resolves only the managed pinned installation and rejects corrupted bytes', async () => {
  const { registry, installed, install } = await fixture()
  expect(await registry.resolve(model)).toBeNull()
  await install()
  expect(await registry.resolve(model)).toBe(installed)
  await writeFile(join(installed, 'model.bin'), Buffer.alloc(bytes.length))
  expect(await registry.resolve(model)).toBeNull()
  await expect(registry.publish(model)).rejects.toThrow('managed-model-required')
})
it('refresh discovers CLI installs, load validates, and never downloads missing diarization', async () => {
  const { registry, install, installed } = await fixture()
  const fetcher = vi.fn()
  const validate = vi.fn(async () => {})
  const environment = {
    check: async () => ({
      platform: 'darwin',
      ffmpeg: true,
      ffprobe: true,
      whisper: true,
      uv: false,
      python: true,
      libraries: true,
      ready: true,
    }),
  }
  const manager = new ResourceManager(
    [model],
    registry,
    new ModelDownloader(fetcher),
    validate,
    environment,
  )
  expect((await manager.read()).development?.diarization?.status).toBe('missing')
  await expect(manager.prepare('diarization')).rejects.toThrow('managed-model-required')
  await install()
  const ready = await manager.read()
  expect(ready.resources[0].status).toBe('ready')
  expect(ready.development?.diarization?.status).toBe('ready')
  expect(validate).toHaveBeenCalledWith(model, installed, expect.any(AbortSignal))
  expect(fetcher).not.toHaveBeenCalled()
  await writeFile(join(installed, 'model.bin'), Buffer.alloc(bytes.length))
  const broken = await manager.read()
  expect(broken.development?.diarization?.status).toBe('invalid')
  expect(broken.development?.ready).toBe(true)
})
it('load failure is unavailable without blocking unrelated base resources', async () => {
  const { registry, install } = await fixture()
  await install()
  const manager = new ResourceManager([model], registry, undefined, async () => {
    throw Error('private details')
  })
  const result = await manager.read()
  expect(result.baseReady).toBe(true)
  expect(result.resources[0]).toMatchObject({ status: 'failed', error: 'managed-model-invalid' })
  expect(JSON.stringify(result)).not.toContain('private details')
  expect(await manager.getModelPaths()).toEqual({})
})

it('validates managed models before exposing paths to speech on a cold start', async () => {
  const { registry, install } = await fixture()
  await install()
  const validate = vi.fn(async () => {
    throw Error('cannot load')
  })
  const manager = new ResourceManager([model], registry, undefined, validate)
  expect(await manager.getModelPaths()).toEqual({})
  expect(validate).toHaveBeenCalledOnce()
})

it('shutdown aborts an in-flight managed load without beginning another check', async () => {
  const { registry, install } = await fixture()
  await install()
  let started!: () => void
  const loading = new Promise<void>((done) => {
    started = done
  })
  const validate = vi.fn(async (_model: ModelDefinition, _path: string, signal: AbortSignal) => {
    started()
    await new Promise<void>((_done, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
  })
  const manager = new ResourceManager([model], registry, undefined, validate)
  const reading = manager.read()
  await loading
  await manager.shutdown()
  await reading
  expect(validate).toHaveBeenCalledOnce()
})

it('shutdown prevents preparation waiting on hydration from starting a download', async () => {
  const { registry } = await fixture()
  const transcription = {
    ...model,
    capability: 'transcription' as const,
    access: 'public' as const,
  }
  let release!: () => void
  const pending = new Promise<void>((done) => {
    release = done
  })
  const download = vi.fn()
  const downloader = new ModelDownloader(download)
  const preferences = {
    read: async () => {
      await pending
      return {}
    },
    setWhisperModel: vi.fn(),
  }
  const manager = new ResourceManager(
    [transcription],
    registry,
    downloader,
    undefined,
    undefined,
    preferences as never,
  )
  const prepare = manager.prepare('base')
  const stopped = manager.shutdown()
  release()
  await Promise.all([prepare, stopped])
  await manager.prepare('base')
  expect(download).not.toHaveBeenCalled()
})
