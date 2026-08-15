import { mkdir, mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { AudioSourceSchema, type ProjectRelativePath } from '../../../shared/project.types'
import { AudioSourceCacheStore } from './AudioSourceCacheStore'

const source = AudioSourceSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'episode.mp3',
  location: { mode: 'copy', path: 'media/episode.mp3' },
  fingerprint: { byteLength: 1, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
  metadata: { durationSeconds: 1, sampleRate: 48_000, channels: 2, codec: 'mp3', bitrateKbps: 192 },
})

async function fixture(pcmFile = `cache/${source.id}/audio.f32le`) {
  const root = await mkdtemp(join(tmpdir(), 'podcut-cache-store-'))
  const cacheRoot = join(root, 'cache', source.id)
  await mkdir(join(cacheRoot, 'waveform'), { recursive: true })
  await mkdir(join(root, 'media'), { recursive: true })
  await writeFile(join(cacheRoot, 'audio.f32le'), new Uint8Array(8))
  await writeFile(join(cacheRoot, 'waveform', 'level-256.minmax-f32le'), new Uint8Array(8))
  await writeFile(join(root, 'media', 'secret.bin'), new Uint8Array(8))
  await writeFile(
    join(cacheRoot, 'manifest.json'),
    JSON.stringify({
      version: 1,
      audioSourceId: source.id,
      sourceSha256: source.fingerprint.sha256,
      generatorVersion: 'podcut-cache-v1',
      pcm: {
        file: pcmFile as ProjectRelativePath,
        sampleFormat: 'f32le',
        layout: 'interleaved',
        sampleRate: 48_000,
        channels: 2,
        frameCount: 1,
        byteLength: 8,
      },
      waveform: {
        representation: 'min-max-f32le',
        levels: [
          {
            file: `cache/${source.id}/waveform/level-256.minmax-f32le`,
            samplesPerBucket: 256,
            bucketCount: 1,
          },
        ],
      },
    }),
  )
  return root
}

describe('AudioSourceCacheStore', () => {
  it('validates exact artifact sizes and returns a path-free descriptor', async () => {
    const store = new AudioSourceCacheStore(await fixture())
    const manifest = await store.validate(source)
    expect(manifest).not.toBeNull()
    expect(store.descriptor(manifest!)).toEqual({
      audioSourceId: source.id,
      sampleRate: 48_000,
      channels: 2,
      frameCount: 1,
      waveformLevels: [{ samplesPerBucket: 256, bucketCount: 1 }],
    })
  })

  it('rejects manifest artifacts outside their source-specific cache directory', async () => {
    const store = new AudioSourceCacheStore(await fixture('media/secret.bin'))
    await expect(store.resolvePcm(source.id)).rejects.toThrow('outside source cache')
    await expect(store.validate(source)).resolves.toBeNull()
  })
})
