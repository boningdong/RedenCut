import { describe, expect, it } from 'vitest'
import type { AudioSourceId } from '@shared/ProjectTypes'
import type { AudioSampleProvider } from '@shared/PlayerTypes'
import type { TrackRenderPlan } from '@shared/audio/AudioRenderPlan'
import { renderTrackBlock } from './TrackBlockRenderer'

const id = 'source' as AudioSourceId
function provider(): AudioSampleProvider {
  return {
    audioSourceId: id,
    format: 'f32-planar',
    sampleRate: 48000,
    channels: 2,
    frameCount: 100,
    readFrames: async (startFrame, frameCount) => ({
      startFrame,
      frameCount,
      channels: [new Float32Array(frameCount).fill(1), new Float32Array(frameCount).fill(0.25)],
    }),
  }
}
const plan: TrackRenderPlan = {
  trackId: 'track',
  volume: 0.2,
  contributions: [
    {
      clipId: 'a',
      source: { audioSourceId: id, sourceStartFrame: 0, frameCount: 5 },
      outputStartFrame: 10,
      gain: 0.5,
      envelope: {
        kind: 'fade',
        direction: 'out',
        curve: 'linear',
        startOutputFrame: 10,
        frameCount: 5,
      },
    },
    {
      clipId: 'b',
      source: { audioSourceId: id, sourceStartFrame: 5, frameCount: 5 },
      outputStartFrame: 10,
      gain: 1,
      envelope: {
        kind: 'fade',
        direction: 'in',
        curve: 'linear',
        startOutputFrame: 10,
        frameCount: 5,
      },
    },
  ],
}
const signal = () => new AbortController().signal

describe('renderTrackBlock', () => {
  it('mixes stereo fade contributions with clip gain once, leaving track volume for the mixer', async () => {
    const out = await renderTrackBlock(plan, 10, 5, new Map([[id, provider()]]), signal())
    expect([...out[0]]).toEqual([0.5, 0.625, 0.75, 0.875, 1])
    expect([...out[1]]).toEqual([0.125, 0.15625, 0.1875, 0.21875, 0.25])
  })
  it('preserves absolute envelope phase on block boundaries and mid-fade seek', async () => {
    const providers = new Map([[id, provider()]])
    const whole = await renderTrackBlock(plan, 8, 10, providers, signal())
    const first = await renderTrackBlock(plan, 8, 4, providers, signal())
    const second = await renderTrackBlock(plan, 12, 6, providers, signal())
    expect([...first[0], ...second[0]]).toEqual([...whole[0]])
    expect([...second[0]]).toEqual([0.75, 0.875, 1, 0, 0, 0])
  })
  it('zero-pads a short provider read and preserves silence', async () => {
    const p = provider()
    p.readFrames = async (startFrame) => ({
      startFrame,
      frameCount: 1,
      channels: [new Float32Array([1]), new Float32Array([0.25])],
    })
    const out = await renderTrackBlock(plan, 10, 5, new Map([[id, p]]), signal())
    expect([...out[0]]).toEqual([0.5, 0, 0, 0, 0])
    const silent = await renderTrackBlock({ ...plan, contributions: [] }, 0, 5, new Map(), signal())
    expect([...silent[0]]).toEqual([0, 0, 0, 0, 0])
  })
  it('rejects cancellation and malformed provider layouts', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      renderTrackBlock(plan, 10, 5, new Map([[id, provider()]]), c.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    const p = provider()
    p.readFrames = async (startFrame, frameCount) => ({
      startFrame,
      frameCount,
      channels: [new Float32Array(1)],
    })
    await expect(renderTrackBlock(plan, 10, 5, new Map([[id, p]]), signal())).rejects.toThrow(
      'channel layout',
    )
  })
})
