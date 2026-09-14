import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ModelDefinitionSchema, ModelManifestSchema } from '../../shared/modelManifest.schema'
import { ModelDownloader, fetchModel } from './ModelDownloader'
import { ModelRegistry } from './ModelRegistry'
import { ResourceManager } from './ResourceManager'
import { resourcePaths } from './resourcePaths'
const bytes = Buffer.from('a real small model fixture')
const model = ModelDefinitionSchema.parse({
  id: 'fixture',
  capability: 'transcription',
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  expectedFiles: ['model.bin'],
  files: [
    {
      path: 'model.bin',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
  license: 'MIT',
  access: 'public',
  profiles: [],
  supportedLanguages: ['zh', 'en'],
})
const roots: string[] = []
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'resource-test-'))
  roots.push(dir)
  return dir
}
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})
function remote(rangeSupport = true): { fetcher: typeof fetch; ranges: (string | null)[] } {
  const ranges: (string | null)[] = []
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'HEAD')
      return new Response(null, {
        headers: { etag: '"same"', 'accept-ranges': rangeSupport ? 'bytes' : 'none' },
      })
    const range = new Headers(init?.headers).get('range')
    ranges.push(range)
    const start = range ? Number(range.match(/\d+/)![0]) : 0
    return new Response(bytes.subarray(start), {
      status: start ? 206 : 200,
      headers: start
        ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` }
        : {},
    })
  }) as typeof fetch
  return { fetcher, ranges }
}
describe('managed model transfers', () => {
  it('resumes only matching identity and verifies before atomic publication', async () => {
    const dir = await root()
    const registry = new ModelRegistry(dir)
    const { staging } = resourcePaths(dir, model)
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'model.bin'), bytes.subarray(0, 5))
    await writeFile(
      join(staging, 'model.bin.download.json'),
      JSON.stringify({ revision: model.revision, etag: '"same"' }),
    )
    expect(await registry.resolve(model)).toBeNull()
    const server = remote()
    const progress: number[] = []
    await new ModelDownloader(server.fetcher).download(
      model,
      staging,
      new AbortController().signal,
      (n) => progress.push(n),
    )
    expect(server.ranges).toEqual(['bytes=5-'])
    expect(progress.at(-1)).toBe(bytes.length)
    await registry.publish(model)
    const path = await registry.resolve(model)
    expect(path).toBeTruthy()
    await writeFile(join(path!, 'model.bin'), Buffer.alloc(bytes.length))
    expect(await registry.resolve(model)).toBeNull()
  })
  it('restarts when ranges are unsupported without appending a full body', async () => {
    const dir = await root()
    await writeFile(join(dir, 'model.bin'), bytes.subarray(0, 5))
    await writeFile(
      join(dir, 'model.bin.download.json'),
      JSON.stringify({ revision: model.revision, etag: '"same"' }),
    )
    const server = remote(false)
    await new ModelDownloader(server.fetcher).download(
      model,
      dir,
      new AbortController().signal,
      () => {},
    )
    expect(server.ranges).toEqual([null])
    expect(await readFile(join(dir, 'model.bin'))).toEqual(bytes)
  })
  it('never publishes an integrity failure', async () => {
    const dir = await root()
    const fetcher = (async (_u: unknown, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null)
        : new Response(Buffer.alloc(bytes.length))) as typeof fetch
    await expect(
      new ModelDownloader(fetcher).download(model, dir, new AbortController().signal, () => {}),
    ).rejects.toThrow('integrity-failed')
    expect(await new ModelRegistry(dir).resolve(model)).toBeNull()
  })
  it('strips authorization on CDN redirects', async () => {
    const seen: (string | null)[] = []
    const fetcher = (async (_u: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'))
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://cdn.example/model' } })
        : new Response(bytes)
    }) as typeof fetch
    await fetchModel(
      'https://huggingface.co/model',
      { headers: { authorization: 'Bearer private' } },
      fetcher,
    )
    expect(seen).toEqual(['Bearer private', null])
  })
  it('deduplicates preparation and preserves completed readiness across restart', async () => {
    const dir = await root()
    const server = remote()
    const manager = new ResourceManager(
      [model],
      new ModelRegistry(dir),
      new ModelDownloader(server.fetcher),
    )
    await Promise.all([manager.prepare('base'), manager.prepare('base')])
    await new Promise<void>((resolve) => {
      const unsubscribe = manager.subscribe((s) => {
        if (s.baseReady) {
          unsubscribe()
          resolve()
        }
      })
    })
    expect(server.ranges).toHaveLength(1)
    expect((await new ResourceManager([model], new ModelRegistry(dir)).read()).baseReady).toBe(true)
  })
  it('rejects traversal and mutable revisions', () => {
    expect(ModelDefinitionSchema.safeParse({ ...model, revision: 'main' }).success).toBe(false)
    expect(
      ModelDefinitionSchema.safeParse({
        ...model,
        files: [{ ...model.files[0], path: '../escape' }],
      }).success,
    ).toBe(false)
  })
})

it('cancel retains partial bytes and explicit resume finishes the same transfer', async () => {
  const dir = await root()
  const controller = new AbortController()
  const downloader = new ModelDownloader((async (_u: unknown, init?: RequestInit) => {
    if (init?.method === 'HEAD')
      return new Response(null, { headers: { etag: '"same"', 'accept-ranges': 'bytes' } })
    return new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(bytes.subarray(0, 5))
        },
        pull(stream) {
          if (controller.signal.aborted) stream.error(new DOMException('Aborted', 'AbortError'))
        },
      }),
    )
  }) as typeof fetch)
  await expect(
    downloader.download(model, dir, controller.signal, (n) => {
      if (n === 5) controller.abort()
    }),
  ).rejects.toThrow()
  expect((await readFile(join(dir, 'model.bin'))).length).toBe(5)
  const server = remote()
  await new ModelDownloader(server.fetcher).download(
    model,
    dir,
    new AbortController().signal,
    () => {},
  )
  expect(server.ranges).toEqual(['bytes=5-'])
})

it('load validation failures prevent publication and ready state', async () => {
  const dir = await root()
  const manager = new ResourceManager(
    [model],
    new ModelRegistry(dir),
    new ModelDownloader(remote().fetcher),
    undefined,
    async () => {
      throw new Error('invalid model structure')
    },
  )
  const finished = new Promise<void>((resolve) => {
    const off = manager.subscribe((s) => {
      if (s.resources[0].status === 'failed') {
        off()
        resolve()
      }
    })
  })
  await manager.prepare('base')
  await finished
  expect((await manager.read()).baseReady).toBe(false)
  expect(await manager.registry.resolve(model)).toBeNull()
})

it('refresh invalidates readiness when an installed file is removed', async () => {
  const dir = await root()
  const manager = new ResourceManager(
    [model],
    new ModelRegistry(dir),
    new ModelDownloader(remote().fetcher),
  )
  const finished = new Promise<void>((resolve) => {
    const off = manager.subscribe((s) => {
      if (s.baseReady) {
        off()
        resolve()
      }
    })
  })
  await manager.prepare('base')
  await finished
  await rm(join(resourcePaths(dir, model).installed, 'model.bin'))
  expect((await manager.read()).baseReady).toBe(false)
})

it('keeps verified diarization usable without tokens or a runtime recheck', async () => {
  const dir = await root()
  const speaker = {
    ...model,
    id: 'speaker',
    capability: 'diarization' as const,
    access: 'gated-auto' as const,
  }
  const registry = new ModelRegistry(dir)
  for (const item of [model, speaker]) {
    const { staging } = resourcePaths(dir, item)
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, 'model.bin'), bytes)
    await registry.publish(item)
  }
  const validate = Object.assign(async () => {}, {
    preflight: async () => {
      throw new Error('runtime is not needed for installed resources')
    },
  })
  const manager = new ResourceManager(
    [model, speaker],
    registry,
    new ModelDownloader(),
    undefined,
    validate,
  )
  expect((await manager.prepare('diarization')).resources.every((r) => r.status === 'ready')).toBe(
    true,
  )
})

it('validates the shipped manifest and rejects masked or unauthenticated integrity metadata', async () => {
  const actual = ModelManifestSchema.parse(
    JSON.parse(await readFile(join(process.cwd(), 'speech-worker/models.json'), 'utf8')),
  )
  expect(actual.models.find((m) => m.id === 'transcription-default')?.files[0].size).toBe(147951465)
  expect(
    ModelDefinitionSchema.safeParse({
      ...model,
      files: [{ ...model.files[0], sha256: '*'.repeat(64) }],
    }).success,
  ).toBe(false)
  expect(
    ModelDefinitionSchema.safeParse({
      ...model,
      files: [{ path: 'model.bin', size: bytes.length, requiresAuthenticatedSha256: true }],
    }).success,
  ).toBe(false)
})

it('resolves gated integrity from authenticated immutable metadata before publication', async () => {
  const dir = await root()
  const gated = ModelDefinitionSchema.parse({
    ...model,
    access: 'gated-auto',
    files: [{ path: 'model.bin', size: bytes.length, requiresAuthenticatedSha256: true }],
  })
  const registry = new ModelRegistry(dir)
  const { staging } = resourcePaths(dir, gated)
  await mkdir(staging, { recursive: true })
  await writeFile(join(staging, 'model.bin'), bytes)
  await expect(registry.publish(gated)).rejects.toThrow('integrity-failed')
  const seen: (string | null)[] = []
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('authorization'))
    return init?.method === 'HEAD'
      ? new Response(null, { headers: { 'x-linked-etag': `"${model.files[0].sha256}"` } })
      : new Response(bytes)
  }) as typeof fetch
  await new ModelDownloader(fetcher).download(
    gated,
    staging,
    new AbortController().signal,
    () => {},
    'hf_explicit',
  )
  await registry.publish(gated)
  const installed = await registry.resolve(gated)
  expect(installed).toBeTruthy()
  expect(seen).toEqual(['Bearer hf_explicit', 'Bearer hf_explicit'])
  const record = JSON.parse(await readFile(join(installed!, 'installation.json'), 'utf8'))
  expect(record.files[0].sha256).toBe(model.files[0].sha256)
  expect(JSON.stringify(record)).not.toContain('hf_explicit')
  await writeFile(join(installed!, 'model.bin'), Buffer.alloc(bytes.length))
  expect(await registry.resolve(gated)).toBeNull()
})

it('blocks downloads before environment setup and allows preparation after validation', async () => {
  let ready = false
  const dir = await root()
  const { fetcher } = remote()
  const registry = new ModelRegistry(dir)
  const manager = new ResourceManager(
    [model],
    registry,
    new ModelDownloader(fetcher),
    undefined,
    async () => {},
    {
      check: async () => ({
        platform: 'darwin',
        ffmpeg: true,
        ffprobe: true,
        whisper: true,
        uv: true,
        python: ready,
        libraries: ready,
        ready,
      }),
    },
  )
  expect((await manager.prepare('base')).development?.ready).toBe(false)
  expect(await registry.resolve(model)).toBeNull()
  ready = true
  expect((await manager.read()).development?.ready).toBe(true)
  await manager.prepare('base')
  await new Promise<void>((resolve) => {
    const stop = manager.subscribe((snapshot) => {
      if (snapshot.baseReady) {
        stop()
        resolve()
      }
    })
  })
  expect(await registry.resolve(model)).toBeTruthy()
})
