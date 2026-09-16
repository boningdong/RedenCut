import { expect, it } from 'vitest'
import type { Track } from '@shared/project.types'
import { redactionSkipRanges } from '@shared/redactionTimeline'
import { buildTrackPlaybackPlan } from './playbackPlan'

const clip = {
  id: 'c',
  trackId: 't',
  audioSourceId: 's',
  sourceStart: 10,
  sourceEnd: 20,
  outputStart: 0,
  muted: false,
  gain: 1,
  effects: [],
  redactions: [
    { id: 'a', sourceStart: 12, sourceEnd: 14 },
    { id: 'b', sourceStart: 14, sourceEnd: 16 },
  ],
}
const track = {
  id: 't',
  name: 'Voice',
  volume: 1,
  muted: false,
  solo: false,
  color: '#fff',
  effects: [],
  clips: [clip],
} as unknown as Track

it('joins touching effects without changing clip identities or stored overlays', () => {
  expect(redactionSkipRanges([track])).toEqual([{ start: 2, end: 6 }])
  expect(track.clips).toHaveLength(1)
  expect(clip.redactions).toHaveLength(2)
})
it('ordinary clip mute never removes duration', () => {
  expect(
    redactionSkipRanges([
      { ...track, clips: [{ ...clip, muted: true, redactions: [] }] } as unknown as Track,
    ]),
  ).toEqual([])
})
it('retained overlapping audio protects time but the redacted track supplies silence', () => {
  expect(
    redactionSkipRanges([
      track,
      { ...track, id: 'other', clips: [{ ...clip, redactions: [] }] } as unknown as Track,
    ]),
  ).toEqual([])
  expect(buildTrackPlaybackPlan(track, 0, 10, 10, false)).toEqual([
    {
      kind: 'samples',
      audioSourceId: 's',
      sourceFrame: 100,
      outputFrame: 0,
      frameCount: 20,
      gain: 1,
    },
    { kind: 'silence', outputFrame: 20, frameCount: 40 },
    {
      kind: 'samples',
      audioSourceId: 's',
      sourceFrame: 160,
      outputFrame: 60,
      frameCount: 40,
      gain: 1,
    },
  ])
})
