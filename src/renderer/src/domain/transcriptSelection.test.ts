import { expect, it } from 'vitest'
import { resolveTranscriptSelection } from './transcriptSelection'
import type { TranscriptOccurrence } from './transcriptProjection'
const occurrence = (scopeId: string, unitId = 'a') =>
  ({
    scopeId,
    unit: { id: unitId, kind: 'speech' },
    clip: { sourceStart: 1, sourceEnd: 3 },
    analysis: {
      transcript: {
        units: [
          { id: 'a', kind: 'speech' },
          { id: 'b', kind: 'speech' },
        ],
      },
      alignment: {
        acousticEditUnits: [
          { id: 'acoustic', transcriptUnitIds: ['a', 'b'], sourceStart: 0, sourceEnd: 4 },
        ],
      },
    },
  }) as TranscriptOccurrence
it('rejects mixed occurrences instead of editing the first occurrence', () => {
  expect(resolveTranscriptSelection([occurrence('first'), occurrence('duplicate')])).toMatchObject({
    editable: false,
    scopeConflict: true,
  })
})
it('retains acoustic expansion but clips edits to the selected timeline occurrence', () => {
  expect(resolveTranscriptSelection([occurrence('first')])).toMatchObject({
    editable: true,
    expanded: true,
    sourceRanges: [{ start: 1, end: 3 }],
    resolvedUnitIds: ['a', 'b'],
  })
})
