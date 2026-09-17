import { expect, it } from 'vitest'
import { continuousTranscriptGroups } from './ContinuousTranscriptGroups'
import type { TranscriptOccurrence } from './transcriptProjection'
const unit = (id: string, track: string, start: number, text: string) =>
  ({
    id,
    scopeId: track,
    track: { id: track },
    unit: { id, text, kind: 'speech' },
    outputStart: start,
    outputEnd: start + 0.1,
    orderTime: start,
  }) as TranscriptOccurrence
it('keeps simultaneous phrases intact instead of interleaving their characters', () => {
  const units = [
    unit('a1', 'a', 0, '周'),
    unit('b1', 'b', 0, '週'),
    unit('a2', 'a', 0.1, '末'),
    unit('b2', 'b', 0.1, '末'),
    unit('later', 'a', 3, '你好'),
  ]
  expect(
    continuousTranscriptGroups(units).map((row) => row.map((u) => u.unit.text).join('')),
  ).toEqual(['周末', '週末', '你好'])
  expect(
    continuousTranscriptGroups(units)
      .flat()
      .map((u) => u.id)
      .sort(),
  ).toEqual(units.map((u) => u.id).sort())
})
it('does not split continuous text when speaker attribution changes', () => {
  const a = unit('a', 'track', 0, 'Hello'),
    b = unit('b', 'track', 0.1, 'there')
  a.speakerId = 'first' as TranscriptOccurrence['speakerId']
  b.speakerId = 'second' as TranscriptOccurrence['speakerId']
  expect(continuousTranscriptGroups([a, b])).toEqual([[a, b]])
})
