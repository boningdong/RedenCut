import { describe, expect, it } from 'vitest'
import { AudioSourceCacheManifestSchema } from './cacheManifest'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000'

function manifest() {
  return {
    version: 1,
    audioSourceId: SOURCE_ID,
    sourceSha256: 'a'.repeat(64),
    generatorVersion: 'riffcut-cache-v1',
    pcm: {
      file: `cache/${SOURCE_ID}/audio.f32le`,
      sampleFormat: 'f32le',
      layout: 'interleaved',
      sampleRate: 48_000,
      channels: 2,
      frameCount: 100,
      byteLength: 800,
    },
    waveform: {
      representation: 'min-max-f32le',
      levels: [256, 4096, 65536].map((level) => ({
        file: `cache/${SOURCE_ID}/waveform/level-${level}.minmax-f32le`,
        samplesPerBucket: level,
        bucketCount: 1,
      })),
    },
  }
}

describe('AudioSourceCacheManifestSchema', () => {
  it('accepts an internally consistent manifest', () => {
    expect(AudioSourceCacheManifestSchema.parse(manifest()).pcm.byteLength).toBe(800)
  })

  it('rejects a PCM byte length inconsistent with frames and channels', () => {
    const value = manifest()
    value.pcm.byteLength = 799
    expect(() => AudioSourceCacheManifestSchema.parse(value)).toThrow()
  })

  it('rejects unsupported generator versions and waveform levels', () => {
    const badGenerator = manifest()
    badGenerator.generatorVersion = 'future'
    expect(() => AudioSourceCacheManifestSchema.parse(badGenerator)).toThrow()

    const badLevel = manifest()
    badLevel.waveform.levels[0].samplesPerBucket = 512
    expect(() => AudioSourceCacheManifestSchema.parse(badLevel)).toThrow()
  })

  it('requires the 48 kHz PCM format and every waveform level', () => {
    const wrongRate = manifest()
    wrongRate.pcm.sampleRate = 44_100
    expect(() => AudioSourceCacheManifestSchema.parse(wrongRate)).toThrow()
    const missingLevel = manifest()
    missingLevel.waveform.levels.pop()
    expect(() => AudioSourceCacheManifestSchema.parse(missingLevel)).toThrow()
  })

  it('rejects waveform bucket counts that do not cover the PCM frame count', () => {
    const value = manifest()
    value.waveform.levels[0].bucketCount = 0
    expect(() => AudioSourceCacheManifestSchema.parse(value)).toThrow('bucket count')
  })
})
