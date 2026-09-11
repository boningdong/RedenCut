import { expect, it } from 'vitest'
import type { Track } from './project.types'
import { redactionSkipRanges } from './redactionTimeline'

function track(
  id: string,
  clips: Array<[number, number, boolean]>,
  muted = false,
  solo = false,
): Track {
  return {
    id,
    muted,
    solo,
    clips: clips.map(([start, end, redacted]) => ({
      outputStart: start,
      sourceStart: 0,
      sourceEnd: end - start,
      muted: redacted,
    })),
  } as Track
}
it('skips only redacted content, preserving natural gaps and merging adjacent redactions', () => {
  expect(
    redactionSkipRanges([
      track('a', [
        [0, 1, false],
        [1, 2, true],
        [2, 3, true],
        [4, 5, false],
        [5, 6, true],
      ]),
    ]),
  ).toEqual([
    { start: 1, end: 3 },
    { start: 5, end: 6 },
  ])
})
it('does not skip retained material on an overlapping track', () => {
  expect(redactionSkipRanges([track('a', [[0, 5, true]]), track('b', [[1, 3, false]])])).toEqual([
    { start: 0, end: 1 },
    { start: 3, end: 5 },
  ])
})
it('ordinary track mute and solo exclusion do not become redactions', () => {
  expect(redactionSkipRanges([track('a', [[0, 5, false]], true)])).toEqual([])
  expect(redactionSkipRanges([track('a', [[0, 5, true]], true)])).toEqual([])
  expect(
    redactionSkipRanges([track('a', [[0, 5, false]], false, true), track('b', [[0, 5, true]])]),
  ).toEqual([])
})
