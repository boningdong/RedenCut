import { describe, expect, it } from 'vitest'
import { attributeSpeakers } from './SpeakerAttribution'

const acousticUnits = [
  { id: 'a1', sourceStart: 0, sourceEnd: 2 },
  { id: 'a2', sourceStart: 3, sourceEnd: 4 },
]

describe('attributeSpeakers', () => {
  it('uses overlap duration, stable display order, and marks exact ties ambiguous', () => {
    let next = 0
    const result = attributeSpeakers(acousticUnits, [
      { speakerLabel: 'raw-b', sourceStart: 0, sourceEnd: 1 },
      { speakerLabel: 'raw-a', sourceStart: 1, sourceEnd: 2 },
      { speakerLabel: 'raw-a', sourceStart: 3, sourceEnd: 4 },
    ], () => `speaker-${++next}`)

    expect(result.speakers).toEqual([
      { id: 'speaker-1', diarizationLabel: 'raw-b', defaultDisplayName: 'Speaker 1' },
      { id: 'speaker-2', diarizationLabel: 'raw-a', defaultDisplayName: 'Speaker 2' },
    ])
    expect(result.attributions[0]).toMatchObject({
      acousticEditUnitId: 'a1', ambiguous: true,
      candidateSpeakerIds: ['speaker-1', 'speaker-2'], confidence: 0.5,
    })
    expect(result.attributions[0]).not.toHaveProperty('speakerId')
    expect(result.attributions[1]).toMatchObject({
      acousticEditUnitId: 'a2', speakerId: 'speaker-2', ambiguous: false, confidence: 1,
    })
  })

  it('leaves unsupported acoustic units explicitly unattributed', () => {
    expect(attributeSpeakers([{ id: 'a1', sourceStart: 4, sourceEnd: 5 }], [], () => 'unused'))
      .toEqual({ speakers: [], attributions: [{ acousticEditUnitId: 'a1', ambiguous: false }] })
  })
})
