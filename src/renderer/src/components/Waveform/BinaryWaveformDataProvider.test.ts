import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioSourceCacheDescriptor } from '@shared/import.types'
import type { AudioSourceId } from '@shared/ProjectTypes'
import { BinaryWaveformDataProvider } from './BinaryWaveformDataProvider'

const descriptor: AudioSourceCacheDescriptor = {
  audioSourceId: '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId,
  sampleRate: 48_000,
  channels: 2,
  frameCount: 480_000,
  waveformLevels: [
    { samplesPerBucket: 256, bucketCount: 1875 },
    { samplesPerBucket: 4096, bucketCount: 118 },
    { samplesPerBucket: 65536, bucketCount: 8 },
  ],
}

afterEach(() => vi.unstubAllGlobals())

describe('BinaryWaveformDataProvider', () => {
  it('selects a bounded visible level and decodes min/max pairs', async () => {
    const bytes = new Uint8Array(304)
    const view = new DataView(bytes.buffer)
    view.setFloat32(0, -0.5, true)
    view.setFloat32(4, 0.75, true)
    view.setFloat32(8, -0.25, true)
    view.setFloat32(12, 0.4, true)
    const fetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 206 }))
    vi.stubGlobal('fetch', fetch)
    const provider = new BinaryWaveformDataProvider(descriptor)

    const result = await provider.readRange({
      sourceStartSeconds: 0,
      sourceEndSeconds: 0.2,
      targetPixelWidth: 100,
      signal: new AbortController().signal,
    })

    expect(fetch).toHaveBeenCalledWith(
      `redencut://cache/${descriptor.audioSourceId}/waveform/256`,
      expect.objectContaining({ headers: { Range: 'bytes=0-303' } }),
    )
    expect(result.buckets.slice(0, 2)).toEqual([
      { min: -0.5, max: 0.75 },
      { min: -0.25, max: expect.closeTo(0.4) },
    ])
  })
})

it('caches the whole original source peak from the coarsest level', async () => {
  const bytes = new Uint8Array(64)
  const data = new DataView(bytes.buffer)
  data.setFloat32(56, -0.875, true)
  const fetch = vi.fn(async () => new Response(bytes, { status: 206 }))
  vi.stubGlobal('fetch', fetch)
  const provider = new BinaryWaveformDataProvider(descriptor)
  expect(await provider.getPeak()).toBe(0.875)
  expect(await provider.getPeak()).toBe(0.875)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith(
    `redencut://cache/${descriptor.audioSourceId}/waveform/65536`,
    expect.objectContaining({ headers: { Range: 'bytes=0-63' } }),
  )
})
