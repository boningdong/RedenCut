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

it('keeps a short phrase ending just outside overlap in reading context without extending overlap', () => {
  const units = [
    unit('mix', 'a', 6.984, 8.533),
    unit('b', 'b', 6.984, 8.533),
    unit('tail', 'a', 8.535, 8.555, '楚'),
  ]
  const blocks = buildDialogueBlocks(units)
  expect(blocks).toHaveLength(1)
  expect(blocks[0].units).toEqual(units)
  expect(blocks[0].overlaps).toEqual([{ start: 6.984, end: 8.533, trackIds: ['a', 'b'] }])
  expect(units[2].outputStart).toBe(8.535)
})

it('does not absorb a long trailing paragraph, changed speaker, or distant phrase into overlap context', () => {
  const initial = [unit('a', 'a', 0, 1), unit('b', 'b', 0, 1)]
  for (const tail of [
    unit('long', 'a', 1.002, 20),
    unit('far', 'a', 2, 2.1),
    { ...unit('speaker', 'a', 1.002, 1.02), speakerId: 'other' as never },
  ]) {
    expect(
      buildDialogueBlocks([...initial, tail]).map((block) => block.units.map((u) => u.id)),
    ).toEqual([['a', 'b'], [tail.id]])
  }
})

it('uses silent current clips to preserve reading continuity through edit fragments', () => {
  const before = fragment('before', 0, 0.5)
  const after = fragment('after', 0.8, 1.3)
  const silent = fragment('silent', 0.5, 0.8)
  const tracks = [{ ...before.track, clips: [before.clip, silent.clip, after.clip] }]
  expect(buildDialogueBlocks([before, after], tracks)).toHaveLength(1)
  expect(
    buildDialogueBlocks(
      [before, after],
      [{ ...tracks[0], clips: [before.clip, { ...silent.clip, sourceEnd: 0.7 }, after.clip] }],
    ),
  ).toHaveLength(2)
})

it('measures boundary context as part of its alignment column and keeps exact acoustic anchors', () => {
  const units = [
    unit('a', 'a', 0, 1, 'A'),
    unit('b', 'b', 0, 1, 'B'),
    unit('tail', 'a', 1.002, 1.02, ' phrase end'),
  ]
  const block = buildDialogueBlocks(units)[0]
  const columns = layoutOverlapColumns(block, 300, (text) => text.length * 10).flatMap(
    (line) => line.columns,
  )
  expect(columns[0].width).toBe(124)
  expect(columns[0].end).toBe(1)
  expect(columns[0].units).toEqual(units)
})

it('bounds boundary context across a chain of short acoustic units', () => {
  const units = [
    unit('a', 'a', 0, 1),
    unit('b', 'b', 0, 1),
    ...Array.from({ length: 20 }, (_, i) =>
      unit(`tail-${i}`, 'a', 1.002 + i * 0.02, 1.022 + i * 0.02),
    ),
  ]
  const blocks = buildDialogueBlocks(units)
  expect(blocks).toHaveLength(2)
  expect(blocks[1].units[blocks[1].units.length - 1]?.id).toBe('tail-19')
  expect(blocks.flatMap((block) => block.units).length).toBe(units.length)
})

it('keeps neighboring true overlap regions separate even when their units fit boundary context', () => {
  const blocks = buildDialogueBlocks([
    unit('a1', 'a', 0, 1),
    unit('b1', 'b', 0, 1),
    unit('a2', 'a', 1.02, 1.04),
    unit('b2', 'b', 1.02, 1.04),
  ])
  expect(blocks.map((block) => block.units.map((u) => u.id))).toEqual([
    ['a1', 'b1'],
    ['a2', 'b2'],
  ])
  expect(
    blocks.map((block) => block.overlaps.map((overlap) => [overlap.start, overlap.end])),
  ).toEqual([[[0, 1]], [[1.02, 1.04]]])
})

it('keeps untimed punctuation with short boundary context without inventing timing', () => {
  const tail = unit('tail', 'a', 1.002, 1.02)
  const punctuation = {
    ...unit('p', 'a', 1.002, 1.02, '。'),
    outputStart: null,
    outputEnd: null,
    unit: { id: 'p', text: '。', kind: 'punctuation' },
  } as TranscriptOccurrence
  const blocks = buildDialogueBlocks([
    unit('a', 'a', 0, 1),
    unit('b', 'b', 0, 1),
    tail,
    punctuation,
  ])
  expect(blocks).toHaveLength(1)
  expect(blocks[0].units).toContain(punctuation)
  expect(punctuation.outputStart).toBeNull()
})

it('groups interleaved unverified text by source without claiming simultaneous speech', () => {
  const units = [
    unit('a1', 'a', 0, 0.5),
    unit('b1', 'b', 0, 0.5),
    unit('a2', 'a', 0.5, 1),
    unit('b2', 'b', 0.5, 1),
    unit('a3', 'a', 1, 1.5),
    unit('b3', 'b', 1, 1.5),
  ].map((item) => ({ ...item, outputStart: null, outputEnd: null }))
  const blocks = buildDialogueBlocks(units)
  expect(blocks.map((block) => block.units.map((item) => item.id))).toEqual([
    ['a1', 'a2', 'a3'],
    ['b1', 'b2', 'b3'],
  ])
  expect(blocks.every((block) => block.overlaps.length === 0)).toBe(true)
})
