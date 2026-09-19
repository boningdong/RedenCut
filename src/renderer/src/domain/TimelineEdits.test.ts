import { describe, expect, it } from 'vitest'
import type { Clip, Track } from '@shared/ProjectTypes'
import { trimClip } from './TimelineEdits'

const original: Clip = {
  id: 'clip',
  trackId: 'track',
  audioSourceId: '00000000-0000-4000-8000-000000000001' as Clip['audioSourceId'],
  sourceStart: 2,
  sourceEnd: 8,
  outputStart: 10,
  gain: 0.75,
  muted: true,
  effects: [{ id: 'gain', type: 'gain', enabled: true, params: { db: 2 } }],
  redactions: [{ id: 'hidden', sourceStart: 0.5, sourceEnd: 9 }],
}

const makeTrack = (clips: Clip[]): Track => ({
  id: 'track',
  name: 'Track',
  clips,
  volume: 1,
  muted: false,
  solo: false,
  color: '#fff',
  effects: [],
})

describe('trimClip', () => {
  it('trims and restores the left edge while preserving metadata and hidden redactions', () => {
    const tracks = [makeTrack([original])]
    const trimmed = trimClip(tracks, 'clip', 'start', 12, 10)!
    const restored = trimClip(trimmed, 'clip', 'start', 9, 10)!

    expect(trimmed[0].clips[0]).toMatchObject({ sourceStart: 4, sourceEnd: 8, outputStart: 12 })
    expect(restored[0].clips[0]).toMatchObject({
      sourceStart: 1,
      sourceEnd: 8,
      outputStart: 9,
      gain: 0.75,
      muted: true,
      effects: original.effects,
      redactions: original.redactions,
    })
    expect(original).toMatchObject({ sourceStart: 2, sourceEnd: 8, outputStart: 10 })
  })

  it('keeps the output start fixed when trimming and restoring the right edge', () => {
    const tracks = [makeTrack([original])]
    const trimmed = trimClip(tracks, 'clip', 'end', 13, 10)!
    const restored = trimClip(trimmed, 'clip', 'end', 18, 10)!

    expect(trimmed[0].clips[0]).toMatchObject({ sourceStart: 2, sourceEnd: 5, outputStart: 10 })
    expect(restored[0].clips[0]).toMatchObject({ sourceStart: 2, sourceEnd: 10, outputStart: 10 })
  })

  it('clamps trims to source limits and neighboring clips', () => {
    const left = { ...original, id: 'left', sourceStart: 0, sourceEnd: 2, outputStart: 5 }
    const right = { ...original, id: 'right', sourceStart: 0, sourceEnd: 2, outputStart: 17 }
    const tracks = [makeTrack([left, original, right])]

    expect(trimClip(tracks, 'clip', 'start', 0, 10)?.[0].clips[1]).toMatchObject({
      sourceStart: 0,
      outputStart: 8,
    })
    expect(trimClip(tracks, 'clip', 'end', 30, 10)?.[0].clips[1]).toMatchObject({
      sourceEnd: 9,
      outputStart: 10,
    })
  })

  it('keeps at least one 48 kHz sample when either edge is trimmed through the other', () => {
    const tracks = [makeTrack([original])]
    const left = trimClip(tracks, 'clip', 'start', 99, 10)![0].clips[0]
    const right = trimClip(tracks, 'clip', 'end', -99, 10)![0].clips[0]
    expect(left.sourceEnd - left.sourceStart).toBeCloseTo(1 / 48_000, 10)
    expect(right.sourceEnd - right.sourceStart).toBeCloseTo(1 / 48_000, 10)
  })

  it('returns null for invalid trims and the unchanged snapshot for a legal no-op', () => {
    const tracks = [makeTrack([original])]
    expect(trimClip(tracks, 'missing', 'start', 10, 10)).toBeNull()
    expect(trimClip(tracks, 'clip', 'start', Number.NaN, 10)).toBeNull()
    expect(trimClip(tracks, 'clip', 'end', 16, -1)).toBeNull()
    expect(trimClip(tracks, 'clip', 'start', 10, 10)).toBe(tracks)
  })
})
