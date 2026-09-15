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
        validation: { version: 1, method: 'audio-evidence' },
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

function consecutive() {
  const a = occurrence('first')
  a.track = { id: 'track', clips: [] } as never
  a.clip = {
    id: 'clip',
    audioSourceId: 'source',
    sourceStart: 0,
    sourceEnd: 4,
    outputStart: 10,
  } as never
  a.analysis = {
    audioSourceId: 'source',
    analysisRevisionId: 'revision',
    transcript: { units: ['a', 'b'].map((id) => ({ id, kind: 'speech', text: id })) },
    alignment: {
      validation: { version: 1, method: 'audio-evidence' },
      acousticEditUnits: [
        { id: 'a', transcriptUnitIds: ['a'], sourceStart: 1, sourceEnd: 2 },
        { id: 'b', transcriptUnitIds: ['b'], sourceStart: 2.1, sourceEnd: 3 },
      ],
    },
  } as never
  return [a, { ...a, unit: { id: 'b', kind: 'speech', text: 'b' } }] as TranscriptOccurrence[]
}
it('redacts a continuous selection including its intervening pause', () => {
  expect(resolveTranscriptSelection(consecutive())).toMatchObject({
    editable: true,
    sourceRanges: [{ start: 1, end: 3 }],
  })
})
it('rejects unverified timestamps even when they look precise', () => {
  const units = consecutive()
  delete (units[0].analysis.alignment as { validation?: unknown }).validation
  expect(resolveTranscriptSelection(units)?.editable).toBe(false)
})
it('rejects selections skipping an intervening speech unit', () => {
  const units = consecutive()
  units[0].analysis.transcript.units.splice(1, 0, {
    id: 'hidden',
    kind: 'speech',
    text: 'hidden',
  } as never)
  expect(resolveTranscriptSelection(units)?.editable).toBe(false)
})
it('allows one continuous occurrence across adjacent sibling clips but rejects moved duplicates', () => {
  const units = consecutive()
  units[0] = { ...units[0], clip: { ...units[0].clip, sourceEnd: 2 } }
  units[1] = {
    ...units[1],
    scopeId: 'second',
    clip: { ...units[1].clip, id: 'next', sourceStart: 2, outputStart: 12 },
  }
  units[0].track.clips = units.map((u) => u.clip)
  expect(resolveTranscriptSelection(units, [units[0].track])).toMatchObject({
    editable: true,
    scopeConflict: false,
    sourceRanges: [{ start: 1, end: 3 }],
  })
  units[1].clip = { ...units[1].clip, outputStart: 20 }
  units[0].track.clips = units.map((u) => u.clip)
  expect(resolveTranscriptSelection(units, [units[0].track])?.editable).toBe(false)
})

it('includes selected unmapped internal text in the continuous edit without treating it as hidden', () => {
  const units = consecutive()
  const middle = { id: 'middle', kind: 'speech', text: '嗯' } as const
  units[0].analysis.transcript.units.splice(1, 0, middle as never)
  units.splice(1, 0, { ...units[0], unit: middle } as TranscriptOccurrence)
  expect(resolveTranscriptSelection(units)).toMatchObject({
    editable: true,
    scopeConflict: false,
    expanded: false,
    resolvedUnitIds: ['a', 'middle', 'b'],
    sourceRanges: [{ start: 1, end: 3 }],
  })
})
it('rejects continuous-looking selections across audio sources', () => {
  const units = consecutive()
  units[1] = {
    ...units[1],
    scopeId: 'other',
    clip: { ...units[1].clip, audioSourceId: 'other' as never },
  }
  expect(resolveTranscriptSelection(units, [units[0].track])?.editable).toBe(false)
})

it('uses persisted inferred boundary ranges directly without inventing renderer timestamps', () => {
  const units = consecutive()
  units[0].analysis.alignment.acousticEditUnits[0] = {
    ...units[0].analysis.alignment.acousticEditUnits[0],
    timingOrigin: 'anchor-inferred',
  }
  expect(resolveTranscriptSelection([units[0]])).toMatchObject({
    editable: true,
    expanded: false,
    sourceRanges: [{ start: 1, end: 2 }],
  })
})
