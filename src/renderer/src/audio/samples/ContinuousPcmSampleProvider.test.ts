import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioSourceId } from '@shared/ProjectTypes'
import { ContinuousPcmSampleProvider } from './ContinuousPcmSampleProvider'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId

afterEach(() => vi.unstubAllGlobals())

describe('ContinuousPcmSampleProvider', () => {
  it('requests only the exact interleaved frame range and deinterleaves channels', async () => {
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    ;[0.25, -0.5, 0.75, -1].forEach((value, index) => view.setFloat32(index * 4, value, true))
    const fetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 206 }))
    vi.stubGlobal('fetch', fetch)
    const provider = new ContinuousPcmSampleProvider({
      audioSourceId: SOURCE_ID,
      sampleRate: 48_000,
      channels: 2,
      frameCount: 100,
      waveformLevels: [],
    })

    const chunk = await provider.readFrames(10, 2, new AbortController().signal)

    expect(fetch).toHaveBeenCalledWith(`redencut://cache/${SOURCE_ID}/pcm`, {
      headers: { Range: 'bytes=80-95' },
      signal: expect.any(AbortSignal),
    })
    expect([...chunk.channels[0]]).toEqual([0.25, 0.75])
    expect([...chunk.channels[1]]).toEqual([-0.5, -1])
  })

  it('clamps at EOF and rejects a server that ignores the range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array(8), { status: 200 })),
    )
    const provider = new ContinuousPcmSampleProvider({
      audioSourceId: SOURCE_ID,
      sampleRate: 48_000,
      channels: 1,
      frameCount: 12,
      waveformLevels: [],
    })

    await expect(provider.readFrames(10, 20, new AbortController().signal)).rejects.toThrow(
      'bounded byte range',
    )
  })
})
