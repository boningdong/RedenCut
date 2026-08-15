import { createHash } from 'crypto'
import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { ProjectFileSchema } from '../../shared/project.types'
import { AudioSourceCacheManifestSchema } from '../audio/cache/cacheManifest'
import type { FfmpegAudioSourceCacheBuilder } from '../audio/import/FfmpegAudioSourceCacheBuilder'
import { WorkspaceController } from './WorkspaceController'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001'

async function packageWithoutCache() {
  const root = await mkdtemp(join(tmpdir(), 'podcut-open-'))
  const bytes = new Uint8Array([1, 2, 3, 4])
  await mkdir(join(root, 'media', SOURCE_ID), { recursive: true })
  await writeFile(join(root, 'media', SOURCE_ID, 'source.wav'), bytes)
  const project = ProjectFileSchema.parse({
    version: 1,
    createdAt: '2026-08-15T00:00:00.000Z',
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [
      {
        id: SOURCE_ID,
        displayName: 'source.wav',
        location: { mode: 'copy', path: `media/${SOURCE_ID}/source.wav` },
        fingerprint: {
          byteLength: bytes.byteLength,
          modifiedTimeMs: 1,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
        metadata: {
          durationSeconds: 1,
          sampleRate: 48_000,
          channels: 1,
          codec: 'pcm_s16le',
          bitrateKbps: 768,
        },
      },
    ],
    tracks: [
      {
        id: 'track-1',
        name: 'Track 1',
        volume: 1,
        muted: false,
        solo: false,
        color: '#fff',
        effects: [],
        clips: [
          {
            id: 'clip-1',
            trackId: 'track-1',
            audioSourceId: SOURCE_ID,
            sourceStart: 0,
            sourceEnd: 1,
            outputStart: 0,
          },
        ],
      },
    ],
  })
  await writeFile(join(root, 'project.json'), JSON.stringify(project))
  return root
}

function generatedManifest(request: Parameters<FfmpegAudioSourceCacheBuilder['build']>[0]) {
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
      channels: 1,
      frameCount: 48_000,
      byteLength: 192_000,
    },
    waveform: {
      representation: 'min-max-f32le',
      levels: [
        {
          file: `${base}/waveform/level-256.minmax-f32le`,
          samplesPerBucket: 256,
          bucketCount: 188,
        },
      ],
    },
  })
}

describe('WorkspaceController cache recovery', () => {
  it('regenerates a missing cache before publishing a newly opened workspace', async () => {
    const build = vi.fn(async (request: Parameters<FfmpegAudioSourceCacheBuilder['build']>[0]) =>
      generatedManifest(request),
    )
    const controller = new WorkspaceController({
      build,
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const result = await controller.open(await packageWithoutCache())
    expect(build).toHaveBeenCalledTimes(1)
    expect(result.sources[0]).toMatchObject({ audioSourceId: SOURCE_ID, sampleRate: 48_000 })
    expect(controller.workspace.root).toBeTruthy()
  })

  it('keeps the previous workspace active when cache regeneration fails', async () => {
    const controller = new WorkspaceController({
      build: vi.fn(async () => {
        throw new Error('decode failed')
      }),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const tempParent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    await controller.initialize(tempParent)
    const previousRoot = controller.workspace.root
    await expect(controller.open(await packageWithoutCache())).rejects.toThrow('decode failed')
    expect(controller.workspace.root).toBe(previousRoot)
  })
})
