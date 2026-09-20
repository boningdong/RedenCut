import { describe, expect, it } from 'vitest'
import { ClipSchema, TrackSchema } from './ProjectTypes'
import { resolveSourceSpans } from './SourceRouting'

const sourceId = '550e8400-e29b-41d4-a716-446655440000'
const masterClip = () =>
  ClipSchema.parse({
    id: 'mix-clip',
    trackId: 'mix',
    audioSourceId: sourceId,
    sourceStart: 10,
    sourceEnd: 14,
    outputStart: 5,
    sourceOverrides: [{ id: 'o', sourceStart: 11, sourceEnd: 13, stemTrackIds: ['stem'] }],
  })
const childClip = (id: string, start: number, end: number, output: number) =>
  ClipSchema.parse({
    id,
    trackId: 'stem',
    audioSourceId: sourceId,
    sourceStart: start,
    sourceEnd: end,
    outputStart: output,
  })
describe('source routing coordinates', () => {
  it('maps moved and trimmed master coverage across existing child clip boundaries', () => {
    const clip = masterClip()
    const tracks = [
      TrackSchema.parse({
        id: 'mix',
        name: 'Mix',
        mixLink: { stemTrackIds: ['stem'] },
        clips: [clip],
      }),
      TrackSchema.parse({
        id: 'stem',
        name: 'Stem',
        clips: [childClip('left', 20, 22, 5), childClip('right', 40, 42, 7)],
      }),
    ]
    expect(
      resolveSourceSpans(tracks, clip, 10, 14).map((span) => [
        span.clipId,
        span.sourceStart,
        span.sourceEnd,
        span.masterSourceStart,
        span.masterSourceEnd,
      ]),
    ).toEqual([
      ['mix-clip', 10, 11, 10, 11],
      ['left', 21, 22, 11, 12],
      ['right', 40, 41, 12, 13],
      ['mix-clip', 13, 14, 13, 14],
    ])
  })
  it('does not treat a fractional-frame discrepancy as a source gap', () => {
    const clip = masterClip()
    const tracks = [
      TrackSchema.parse({
        id: 'mix',
        name: 'Mix',
        mixLink: { stemTrackIds: ['stem'] },
        clips: [clip],
      }),
      TrackSchema.parse({
        id: 'stem',
        name: 'Stem',
        clips: [childClip('left', 20, 22, 5), childClip('right', 40, 42, 7 + 0.1 / 48000)],
      }),
    ]
    expect(() => resolveSourceSpans(tracks, clip, 11, 13)).not.toThrow()
  })
})
