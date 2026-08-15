import { mkdtemp, readFile, readdir, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { ProjectWorkspace } from '../../project/ProjectWorkspace'
import { AudioSourceCacheManifestSchema } from '../cache/cacheManifest'
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
    generatorVersion: 'podcut-cache-v1',
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
  const parent = await mkdtemp(join(tmpdir(), 'podcut-import-'))
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

describe('ImportCoordinator transaction', () => {
  it('publishes copied media and project state only after cache completion', async () => {
    const builder = { build: vi.fn(async (request: CacheBuildRequest) => manifest(request)) }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    const result = await coordinator.import(IMPORT_ID, sourcePath, 'copy', workspace.project)
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
    const parent = await mkdtemp(join(tmpdir(), 'podcut-import-'))
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
      coordinator.import(IMPORT_ID, sourcePath, 'copy', workspace.project),
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
    const first = coordinator.import(IMPORT_ID, sourcePath, 'reference', workspace.project)
    await didStart
    await expect(
      coordinator.import(
        '00000000-0000-4000-8000-000000000003',
        sourcePath,
        'copy',
        workspace.project,
      ),
    ).rejects.toThrow('already active')
    coordinator.cancel(IMPORT_ID)
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readdir(join(workspace.root, '.staging'))).toEqual([])
  })

  it('rejects renderer-controlled import IDs that are not UUID path segments', async () => {
    const builder = { build: vi.fn(async (request: CacheBuildRequest) => manifest(request)) }
    const { coordinator, workspace, sourcePath } = await setup(builder)
    await expect(
      coordinator.import('../outside', sourcePath, 'copy', workspace.project),
    ).rejects.toThrow('Invalid import ID')
    expect(builder.build).not.toHaveBeenCalled()
    await expect(stat(join(workspace.root, 'media'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
