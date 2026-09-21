import { expect, it } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import { getMixRangeState } from './MixRangeState'
const track: Track = {
  id: 'mix',
  name: 'Mix',
  color: '#aaa',
  muted: false,
  solo: false,
  volume: 1,
  effects: [],
  clips: [
    {
      id: 'clip',
      trackId: 'mix',
      audioSourceId: 'a' as Track['clips'][number]['audioSourceId'],
      sourceStart: 10,
      sourceEnd: 20,
      outputStart: 5,
      gain: 1,
      muted: false,
      effects: [],
      sourceOverrides: [
        { id: 'one', sourceStart: 11, sourceEnd: 13, stemTrackIds: ['b'] },
        { id: 'two', sourceStart: 13, sourceEnd: 15, stemTrackIds: ['c'] },
      ],
    },
  ],
}
it('reports different replacements as mixed, never their union', () => {
  expect(getMixRangeState(track, 6, 10)).toEqual({ kind: 'mixed', ids: [], hasReplacement: true })
})
it('reports original audio plus a replacement as mixed', () => {
  expect(getMixRangeState(track, 5, 7).kind).toBe('mixed')
})
it('uses source to output mapping and reopens one source accurately', () => {
  expect(getMixRangeState(track, 6.5, 7.5)).toEqual({
    kind: 'uniform',
    ids: ['b'],
    hasReplacement: true,
  })
})
it('reports untouched audio without a restorable replacement', () => {
  expect(getMixRangeState(track, 11, 14)).toEqual({
    kind: 'original',
    ids: [],
    hasReplacement: false,
  })
})
