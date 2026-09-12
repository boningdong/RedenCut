import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { ProjectWorkspace } from '../../project/ProjectWorkspace'
import { AudioSourceCacheManifestSchema } from '../cache/cacheManifest'
import type { ProjectFile } from '../../../shared/project.types'
import type { CacheBuildRequest } from './FfmpegAudioSourceCacheBuilder'
import { ImportCoordinator } from './ImportCoordinator'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001'
const IMPORT_ID = '00000000-0000-4000-8000-000000000002'
const metadata = {
  durationSeconds: 1,
  sampleRate: 44_100,
  channels: 2,
  codec: 'mp3',
  bitrateKbps: 192,
}

function manifest(request: CacheBuildRequest) {
  const base = `cache/${request.audioSourceId}`
  return AudioSourceCacheManifestSchema.parse({
    version: 1,
    audioSourceId: request.audioSourceId,
    sourceSha256: request.sourceSha256,
    generatorVersion: 'redencut-cache-v1',
    pcm: {
      file: `${base}/audio.f32le`,
      sampleFormat: 'f32le',
      layout: 'interleaved',
      sampleRate: 48_000,
      channels: 2,
      frameCount: 48_000,
      byteLength: 384_000,
    },
    waveform: {
      representation: 'min-max-f32le',
      levels: [256, 4096, 65536].map((level) => ({
        file: `${base}/waveform/level-${level}.minmax-f32le`,
        samplesPerBucket: level,
        bucketCount: Math.ceil(48_000 / level),
      })),
    },
  })
}

async function setup(builder: {
  build: (request: CacheBuildRequest, signal: AbortSignal) => Promise<ReturnType<typeof manifest>>
}) {
  const parent = await mkdtemp(join(tmpdir(), 'redencut-import-'))
  const workspace = await ProjectWorkspace.initialize(parent)
  const sourcePath = join(parent, 'episode.mp3')
  await writeFile(sourcePath, new Uint8Array([1, 2, 3, 4]))
  const coordinator = new ImportCoordinator(workspace, {
    builder,
    probe: vi.fn(async () => metadata),
    createId: () => SOURCE_ID,
    availableBytes: vi.fn(async () => Number.MAX_SAFE_INTEGER),
  })
  return { coordinator, workspace, sourcePath }
}

async function buildStagedCache(request: CacheBuildRequest) {
  const result = manifest(request)
  const root = join(request.projectRoot, 'cache', request.audioSourceId)
  await mkdir(join(root, 'waveform'), { recursive: true })
  await writeFile(join(root, 'audio.f32le'), new Uint8Array())
  await writeFile(join(root, 'manifest.json'), JSON.stringify(result))
  return result
}

function commitToWorkspace(workspace: ProjectWorkspace) {
  return async <T>(
    operation: (commit: (project: ProjectFile) => Promise<T>) => Promise<T>,
  ): Promise<T> =>
    operation(async (project) => {
      await workspace.save(project)
      return 'committed' as T
    })
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ImportCoordinator transaction', () => {
  it('publishes copied media and project state only after cache completion', async () => {
    const builder = { build: vi.fn(buildStagedCache) }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    const result = await coordinator.import(
      IMPORT_ID,
      sourcePath,
      'copy',
      workspace.project,
      commitToWorkspace(workspace),
    )
    expect(result.source.location.mode).toBe('copy')
    expect(result.project.audioSources).toEqual([result.source])
    expect(result.project.tracks[0].clips[0].audioSourceId).toBe(result.source.id)
    const mediaPath = join(workspace.root, 'media', SOURCE_ID, 'episode.mp3')
    expect([...new Uint8Array(await readFile(mediaPath))]).toEqual([1, 2, 3, 4])
    expect(
      JSON.parse(await readFile(join(workspace.root, 'project.json'), 'utf8')).audioSources,
    ).toHaveLength(1)
  })

  it('fails preflight without starting cache construction when disk space is insufficient', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-import-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const sourcePath = join(parent, 'episode.mp3')
    await writeFile(sourcePath, new Uint8Array([1]))
    const build = vi.fn()
    const coordinator = new ImportCoordinator(workspace, {
      builder: { build },
      probe: vi.fn(async () => metadata),
      createId: () => SOURCE_ID,
      availableBytes: vi.fn(async () => 1),
    })
    await expect(
      coordinator.import(
        IMPORT_ID,
        sourcePath,
        'copy',
        workspace.project,
        commitToWorkspace(workspace),
      ),
    ).rejects.toThrow('Not enough disk space')
    expect(build).not.toHaveBeenCalled()
    expect(workspace.project.audioSources).toEqual([])
  })

  it('rejects concurrent imports and cleans staging after cancellation', async () => {
    let started!: () => void
    const didStart = new Promise<void>((resolve) => {
      started = resolve
    })
    const builder = {
      build: vi.fn(async (request: CacheBuildRequest, signal: AbortSignal) => {
        started()
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          ),
        )
        return manifest(request)
      }),
    }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    const first = coordinator.import(
      IMPORT_ID,
      sourcePath,
      'reference',
      workspace.project,
      commitToWorkspace(workspace),
    )
    await didStart
    await expect(
      coordinator.import(
        '00000000-0000-4000-8000-000000000003',
        sourcePath,
        'copy',
        workspace.project,
        commitToWorkspace(workspace),
      ),
    ).rejects.toThrow('already active')
    expect(coordinator.cancel(IMPORT_ID)).toBe('cancelled')
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readdir(join(workspace.root, '.staging'))).toEqual([])
  })

  it('does not start a pre-aborted copy or continue into cache construction', async () => {
    const builder = { build: vi.fn(buildStagedCache) }
    const { coordinator, workspace, sourcePath } = await setup(builder)

    const importing = coordinator.import(
      IMPORT_ID,
      sourcePath,
      'copy',
      workspace.project,
      commitToWorkspace(workspace),
      (progress) => {
        if (progress.stage === 'copying' && progress.percent === 0) {
          expect(coordinator.cancel(IMPORT_ID)).toBe('cancelled')
        }
      },
    )

    await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
    expect(builder.build).not.toHaveBeenCalled()
    expect(await readdir(join(workspace.root, '.staging'))).toEqual([])
  })

  it('contains an asynchronous copy-writer failure and removes only its owned partial stage', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-import-writer-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const sourcePath = join(parent, 'episode.mp3')
    await writeFile(sourcePath, new Uint8Array([1, 2, 3, 4]))
    const sibling = join(parent, 'keep.txt')
    await writeFile(sibling, 'keep')
    const build = vi.fn()
    const copy = vi.fn(async (_source: string, destination: string) => {
      await writeFile(destination, 'partial')
      await Promise.resolve()
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    })
    const coordinator = new ImportCoordinator(workspace, {
      builder: { build },
      probe: vi.fn(async () => metadata),
      createId: () => SOURCE_ID,
      availableBytes: vi.fn(async () => Number.MAX_SAFE_INTEGER),
      copy,
    } as never)

    await expect(
      coordinator.import(
        IMPORT_ID,
        sourcePath,
        'copy',
        workspace.project,
        commitToWorkspace(workspace),
      ),
    ).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(build).not.toHaveBeenCalled()
    expect(await readFile(sibling, 'utf8')).toBe('keep')
    expect(await readdir(join(workspace.root, '.staging'))).toEqual([])
  })

  it('rejects renderer-controlled import IDs that are not UUID path segments', async () => {
    const builder = { build: vi.fn(buildStagedCache) }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    await expect(
      coordinator.import(
        '../outside',
        sourcePath,
        'copy',
        workspace.project,
        commitToWorkspace(workspace),
      ),
    ).rejects.toThrow('Invalid import ID')
    expect(builder.build).not.toHaveBeenCalled()
    await expect(stat(join(workspace.root, 'media'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps prepared artifacts unpublished until the commit boundary and cancels before entry', async () => {
    const boundaryRequested = deferred()
    const enterBoundary = deferred()
    const builder = {
      build: vi.fn(buildStagedCache),
    }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    const importing = coordinator.import(
      IMPORT_ID,
      sourcePath,
      'copy',
      workspace.project,
      async (operation) => {
        boundaryRequested.resolve()
        await enterBoundary.promise
        return operation(async (project) => {
          await workspace.save(project)
          return 'committed'
        })
      },
    )
    await boundaryRequested.promise
    await expect(stat(join(workspace.root, 'media', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(join(workspace.root, 'cache', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    expect(coordinator.cancel(IMPORT_ID)).toBe('cancelled')
    enterBoundary.resolve()
    await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
    expect(workspace.project.audioSources).toEqual([])
    await expect(stat(join(workspace.root, 'media', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(join(workspace.root, 'cache', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readdir(join(workspace.root, '.staging'))).toEqual([])
  })

  it('reports commit-won once publication starts and preserves the committed result', async () => {
    const commitStarted = deferred()
    const finishCommit = deferred()
    const builder = { build: vi.fn(buildStagedCache) }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    const importing = coordinator.import(
      IMPORT_ID,
      sourcePath,
      'copy',
      workspace.project,
      async (operation) =>
        operation(async (project) => {
          commitStarted.resolve()
          await finishCommit.promise
          await workspace.save(project)
          return 'committed'
        }),
    )
    await commitStarted.promise

    expect(coordinator.cancel(IMPORT_ID)).toBe('commit-won')
    finishCommit.resolve()
    await expect(importing).resolves.toMatchObject({ value: 'committed' })
    expect(workspace.project.audioSources).toHaveLength(1)
    await expect(stat(join(workspace.root, 'media', SOURCE_ID))).resolves.toBeDefined()
    await expect(stat(join(workspace.root, 'cache', SOURCE_ID))).resolves.toBeDefined()
  })

  it('does not roll back a committed import when a ready progress listener fails', async () => {
    const builder = { build: vi.fn(buildStagedCache) }
    const { coordinator, workspace, sourcePath } = await setup(builder)

    await expect(
      coordinator.import(
        IMPORT_ID,
        sourcePath,
        'copy',
        workspace.project,
        commitToWorkspace(workspace),
        (progress) => {
          if (progress.stage === 'ready') throw new Error('renderer disappeared')
        },
      ),
    ).resolves.toMatchObject({ value: 'committed' })
    expect(workspace.project.audioSources).toHaveLength(1)
    await expect(stat(join(workspace.root, 'media', SOURCE_ID))).resolves.toBeDefined()
    await expect(stat(join(workspace.root, 'cache', SOURCE_ID))).resolves.toBeDefined()
  })

  it('removes only unpublished import artifacts when commit fails', async () => {
    const builder = { build: vi.fn(buildStagedCache) }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    const prior = workspace.project

    await expect(
      coordinator.import(IMPORT_ID, sourcePath, 'copy', workspace.project, async (operation) =>
        operation(async () => {
          throw new Error('commit failed')
        }),
      ),
    ).rejects.toThrow('commit failed')

    expect(workspace.project).toEqual(prior)
    await expect(stat(join(workspace.root, 'media', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(join(workspace.root, 'cache', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(coordinator.cancel(IMPORT_ID)).toBe('not-found')
  })

  it('revalidates a referenced source after cache construction and before commit', async () => {
    let sourcePath = ''
    const builder = {
      build: vi.fn(async (request: CacheBuildRequest) => {
        const result = await buildStagedCache(request)
        await writeFile(sourcePath, new Uint8Array([4, 3, 2, 1]))
        return result
      }),
    }
    const setupResult = await setup(builder)
    ;({ sourcePath } = setupResult)
    const runCommitBoundary = vi.fn(commitToWorkspace(setupResult.workspace))

    await expect(
      setupResult.coordinator.import(
        IMPORT_ID,
        sourcePath,
        'reference',
        setupResult.workspace.project,
        runCommitBoundary,
      ),
    ).rejects.toThrow('Original audio changed since import')

    expect(runCommitBoundary).not.toHaveBeenCalled()
    expect(setupResult.workspace.project.audioSources).toEqual([])
    await expect(stat(join(setupResult.workspace.root, 'cache', SOURCE_ID))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readdir(join(setupResult.workspace.root, '.staging'))).toEqual([])
  })

  it('attempts every rollback cleanup and aggregates failures with the commit error', async () => {
    const builder = { build: vi.fn(buildStagedCache) }
    const parent = await mkdtemp(join(tmpdir(), 'redencut-import-cleanup-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const sourcePath = join(parent, 'episode.mp3')
    await writeFile(sourcePath, new Uint8Array([1, 2, 3, 4]))
    const commitError = new Error('commit failed')
    const cleanupErrors = [
      new Error('media cleanup failed'),
      new Error('cache cleanup failed'),
      new Error('staging cleanup failed'),
    ]
    const remove = vi.fn(async () => {
      throw cleanupErrors[remove.mock.calls.length - 1]
    })
    const coordinator = new ImportCoordinator(workspace, {
      builder,
      probe: vi.fn(async () => metadata),
      createId: () => SOURCE_ID,
      availableBytes: vi.fn(async () => Number.MAX_SAFE_INTEGER),
      remove,
    } as never)

    const error = (await coordinator
      .import(IMPORT_ID, sourcePath, 'copy', workspace.project, async (operation) =>
        operation(async () => {
          throw commitError
        }),
      )
      .catch((reason: AggregateError) => reason)) as AggregateError

    expect(error).toBeInstanceOf(AggregateError)
    expect(error.errors).toEqual([commitError, ...cleanupErrors])
    expect(remove).toHaveBeenCalledTimes(3)
  })
})
