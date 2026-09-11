import { expect, it } from 'vitest'
import { buildDialogueBlocks, layoutOverlapColumns } from './transcriptDialogue'
import type { TranscriptOccurrence } from './transcriptProjection'
function unit(
  id: string,
  track: string,
  start: number,
  end: number,
  text = id,
): TranscriptOccurrence {
  return {
    id,
    scopeId: track,
    track: { id: track },
    unit: { id, text, kind: 'speech' },
    outputStart: start,
    outputEnd: end,
    orderTime: start,
    muted: false,
  } as TranscriptOccurrence
}
it('keeps two disjoint interjections linked by a long acoustic unit in one card without duplicating words', () => {
  const units = [unit('long', 'a', 0, 10), unit('one', 'b', 2, 3), unit('two', 'b', 7, 8)]
  const blocks = buildDialogueBlocks(units)
  expect(blocks).toHaveLength(1)
  expect(blocks[0].overlaps.map((o) => [o.start, o.end])).toEqual([
    [2, 3],
    [7, 8],
  ])
  expect(blocks[0].units.map((u) => u.id)).toEqual(['long', 'one', 'two'])
})
it('measures column content, wraps shared columns, and keeps punctuation with its speech', () => {
  const a = unit('a', 'a', 0, 1, 'long text'),
    b = unit('b', 'b', 0.5, 1, 'B'),
    p = {
      ...unit('p', 'b', 0.5, 1, '.'),
      unit: { id: 'p', text: '.', kind: 'punctuation' },
      outputStart: null,
      outputEnd: null,
    } as TranscriptOccurrence
  const block = buildDialogueBlocks([a, b, p])[0]
  const layout = layoutOverlapColumns(block, 100, (text) => text.length * 10)
  expect(
    layout
      .flatMap((line) => line.columns)
      .flatMap((c) => c.units)
      .map((u) => u.id)
      .sort(),
  ).toEqual(['a', 'b', 'p'])
  expect(layout.every((line) => line.columns.reduce((n, c) => n + c.width, 0) <= 100)).toBe(true)
  expect(
    layout
      .flatMap((line) => line.columns)
      .find((c) => c.units.some((u) => u.id === 'p'))
      ?.units.map((u) => u.id),
  ).toContain('b')
})
it('leaves nonoverlapping turns outside cards, including the gap between unrelated overlaps', () => {
  const blocks = buildDialogueBlocks([
    unit('a', 'a', 0, 1),
    unit('b', 'b', 0.2, 0.8),
    unit('gap', 'a', 2, 3),
    unit('c', 'a', 4, 5),
    unit('d', 'b', 4.2, 4.8),
  ])
  expect(blocks.map((b) => b.overlaps.length > 0)).toEqual([true, false, true])
})

it('groups interleaved audible and muted occurrences into coherent natural paragraphs', () => {
  const units = [
    unit('a1', 'a', 0, 0.5),
    { ...unit('b1', 'b', 0, 0.5), muted: true },
    unit('a2', 'a', 0.5, 1),
    { ...unit('b2', 'b', 0.5, 1), muted: true },
    unit('a3', 'a', 1, 1.5),
    { ...unit('b3', 'b', 1, 1.5), muted: true },
  ]
  const blocks = buildDialogueBlocks(units)
  expect(blocks.map((block) => block.units.map((item) => item.id))).toEqual([
    ['a1', 'a2', 'a3'],
    ['b1', 'b2', 'b3'],
  ])
  expect(blocks.every((block) => block.overlaps.length === 0)).toBe(true)
})

it('breaks interleaved natural context at speaker changes, long gaps, and overlap cards', () => {
  const units = [
    unit('a1', 'a', 0, 0.5),
    { ...unit('muted1', 'm', 0, 0.5), muted: true },
    { ...unit('a2', 'a', 0.5, 1), speakerId: 'other' as never },
    unit('overlap1', 'a', 1, 2),
    unit('overlap2', 'b', 1, 2),
    { ...unit('muted2', 'm', 1.5, 2), muted: true },
    unit('after', 'a', 2, 2.5),
    { ...unit('muted3', 'm', 2, 2.5), muted: true },
    unit('gap', 'a', 5, 6),
  ]
  const natural = buildDialogueBlocks(units).filter((block) => !block.overlaps.length)
  expect(natural.map((block) => block.units.map((item) => item.id))).toEqual([
    ['a1'],
    ['muted1'],
    ['a2'],
    ['muted2'],
    ['after'],
    ['muted3'],
    ['gap'],
  ])
})

it('preserves sequential audible conversational turns despite repeated occurrence identity', () => {
  const blocks = buildDialogueBlocks([
    unit('a-first', 'a', 0, 1),
    unit('b-turn', 'b', 1, 1.4),
    unit('a-return', 'a', 1.4, 2),
  ])
  expect(blocks.map((block) => block.units.map((item) => item.id))).toEqual([
    ['a-first'],
    ['b-turn'],
    ['a-return'],
  ])
})

function fragment(id: string, start: number, end: number, muted = false): TranscriptOccurrence {
  return {
    ...unit(id, 'a', start, end),
    scopeId: id,
    analysis: { audioSourceId: 'source', analysisRevisionId: 'revision' },
    clip: { id, audioSourceId: 'source', sourceStart: start, sourceEnd: end, outputStart: start },
    sourceStart: start,
    sourceEnd: end,
    muted,
  } as TranscriptOccurrence
}

it('keeps a sentence inline across contiguous audio edit fragments without losing occurrence identity', () => {
  const units = [
    fragment('before', 0, 0.5),
    fragment('deleted', 0.5, 1, true),
    fragment('after', 1, 1.5),
  ]
  const blocks = buildDialogueBlocks(units)
  expect(blocks).toHaveLength(1)
  expect(blocks[0].units).toEqual(units)
  expect(blocks[0].units.map((u) => u.scopeId)).toEqual(['before', 'deleted', 'after'])
})

it('does not merge moved, repeated, or unrelated source occurrences into the original sentence', () => {
  const before = fragment('before', 0, 0.5)
  const after = fragment('after', 0.5, 1)
  for (const clip of [
    { ...after.clip, outputStart: 0.7 },
    { ...after.clip, sourceStart: 0, sourceEnd: 0.5 },
    { ...after.clip, audioSourceId: 'other' },
  ]) {
    expect(
      buildDialogueBlocks([before, { ...after, clip: clip as TranscriptOccurrence['clip'] }]),
    ).toHaveLength(2)
  }
})
