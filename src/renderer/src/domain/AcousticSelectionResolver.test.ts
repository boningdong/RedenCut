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
