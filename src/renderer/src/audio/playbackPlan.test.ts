import { describe, expect, it } from 'vitest'
import type { AudioSourceId, Track } from '@shared/project.types'
import { buildTrackPlaybackPlan } from './playbackPlan'

const SOURCE = '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId

function track(): Track {
  return {
    id: 'track-1',
    name: 'Voice',
    volume: 0.8,
    muted: false,
    solo: false,
    color: '#fff',
    effects: [],
    clips: [
      {
        id: 'clip-1',
        trackId: 'track-1',
        audioSourceId: SOURCE,
        sourceStart: 10,
        sourceEnd: 12,
        outputStart: 1,
        gain: 0.5,
        muted: false,
        effects: [],
      },
    ],
  }
}

describe('buildTrackPlaybackPlan', () => {
  it('maps output frames to source frames and inserts explicit silence', () => {
    expect(buildTrackPlaybackPlan(track(), 0, 4, 100, false)).toEqual([
      { kind: 'silence', outputFrame: 0, frameCount: 100 },
      {
        kind: 'samples',
        audioSourceId: SOURCE,
        sourceFrame: 1000,
        outputFrame: 100,
        frameCount: 200,
        gain: 0.5,
      },
      { kind: 'silence', outputFrame: 300, frameCount: 100 },
    ])
  })

  it('starts inside a clip without reading preceding source frames', () => {
    expect(buildTrackPlaybackPlan(track(), 2, 4, 100, false)[0]).toEqual({
      kind: 'samples',
      audioSourceId: SOURCE,
      sourceFrame: 1100,
      outputFrame: 200,
      frameCount: 100,
      gain: 0.5,
    })
  })

  it('plans only silence for muted or excluded-by-solo tracks', () => {
    expect(buildTrackPlaybackPlan({ ...track(), muted: true }, 0, 4, 100, false)).toEqual([
      { kind: 'silence', outputFrame: 0, frameCount: 400 },
    ])
    expect(buildTrackPlaybackPlan(track(), 0, 4, 100, true)).toEqual([
      { kind: 'silence', outputFrame: 0, frameCount: 400 },
    ])
  })
})
