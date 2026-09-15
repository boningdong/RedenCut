import { describe, expect, it } from 'vitest'
import { AcousticSelectionResolver } from './AcousticSelectionResolver'

const units = [
  { id: 'u1', text: '觉', kind: 'speech' as const },
  { id: 'u2', text: '得', kind: 'speech' as const },
  { id: 'p1', text: '。', kind: 'punctuation' as const },
  { id: 'u3', text: '嗯', kind: 'speech' as const },
]
const acoustic = [{ id: 'a1', transcriptUnitIds: ['u1', 'u2'], sourceStart: 0.75, sourceEnd: 1.18 }]

describe('AcousticSelectionResolver', () => {
  it('expands a partial acoustic unit without fabricating sub-unit times', () => {
    expect(new AcousticSelectionResolver(units, acoustic).resolve(['u1'])).toEqual({
      requestedUnitIds: ['u1'],
      resolvedUnitIds: ['u1', 'u2'],
      acousticEditUnitIds: ['a1'],
      sourceRanges: [{ start: 0.75, end: 1.18 }],
      expanded: true,
      unalignedUnitIds: [],
      editable: true,
    })
  })

  it('keeps punctuation selectable but never turns it into an audio edit', () => {
    expect(new AcousticSelectionResolver(units, acoustic).resolve(['p1'])).toMatchObject({
      requestedUnitIds: ['p1'],
      resolvedUnitIds: [],
      sourceRanges: [],
      expanded: false,
      editable: false,
    })
  })

  it('blocks a mixed selection containing unaligned speech and canonicalizes duplicate order', () => {
    expect(
      new AcousticSelectionResolver(units, acoustic).resolve(['u3', 'u1', 'u1']),
    ).toMatchObject({
      requestedUnitIds: ['u3', 'u1'],
      resolvedUnitIds: ['u1', 'u2'],
      unalignedUnitIds: ['u3'],
      editable: false,
    })
  })
})

const bracketedUnits = ['left', 'middle', 'right'].map((id) => ({ id, kind: 'speech' as const }))
const bracketedAudio = [
  { id: 'left-audio', transcriptUnitIds: ['left'], sourceStart: 1, sourceEnd: 2 },
  { id: 'right-audio', transcriptUnitIds: ['right'], sourceStart: 3, sourceEnd: 4 },
]
it('allows unmapped internal speech enclosed by valid outer boundaries', () => {
  expect(
    new AcousticSelectionResolver(bracketedUnits, bracketedAudio).resolve([
      'right',
      'middle',
      'left',
    ]),
  ).toMatchObject({
    editable: true,
    expanded: false,
    resolvedUnitIds: ['left', 'middle', 'right'],
    unalignedUnitIds: ['middle'],
  })
})
it.each([['middle', 'right'], ['left', 'middle'], ['middle']])(
  'blocks unmapped selection boundaries: %j',
  (...ids) => {
    expect(
      new AcousticSelectionResolver(bracketedUnits, bracketedAudio).resolve(ids).editable,
    ).toBe(false)
  },
)
it('rejects reversed acoustic boundaries instead of widening the edit', () => {
  const reversed = bracketedAudio.map((unit, index) => ({
    ...unit,
    sourceStart: index ? 1 : 3,
    sourceEnd: index ? 2 : 4,
  }))
  expect(
    new AcousticSelectionResolver(bracketedUnits, reversed).resolve(['left', 'right']).editable,
  ).toBe(false)
})
it('rejects mapped internal speech outside the outer acoustic boundaries', () => {
  const audio = [
    ...bracketedAudio,
    { id: 'middle-audio', transcriptUnitIds: ['middle'], sourceStart: 6, sourceEnd: 7 },
  ]
  expect(
    new AcousticSelectionResolver(bracketedUnits, audio).resolve(['left', 'middle', 'right'])
      .editable,
  ).toBe(false)
})
