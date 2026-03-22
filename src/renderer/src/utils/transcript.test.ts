import { describe, it, expect } from 'vitest'
import { mergeTrackWords } from './transcript'
import type { Word } from '@shared/project.types'

// Minimal word factory
const w = (id: string, start: number, sourceFileId?: string): Word => ({
  id,
  text: id,
  start,
  end: start + 1,
  muted: false,
  sourceFileId,
})

describe('mergeTrackWords', () => {
  it('replaces existing words for the given sourceFileId', () => {
    const existing = [w('a', 0, 'sf1'), w('b', 2, 'sf2')]
    const incoming = [w('c', 1, 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'sf1')
    // sf1 words replaced by incoming; sf2 word kept; sorted by start
    expect(result.map((x) => x.id)).toEqual(['c', 'b'])
  })

  it('sorts the result by start time', () => {
    const existing = [w('a', 5, 'sf1'), w('b', 1, 'sf2')]
    const incoming = [w('c', 3, 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'sf1')
    expect(result.map((x) => x.start)).toEqual([1, 3])
  })

  it('preserves words with undefined sourceFileId (legacy)', () => {
    const existing = [w('legacy', 0, undefined)]
    const incoming = [w('new', 1, 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'sf1')
    expect(result.some((x) => x.id === 'legacy')).toBe(true)
  })

  it('handles empty existing array', () => {
    const result = mergeTrackWords([], [w('a', 0, 'sf1')], 'sf1')
    expect(result).toHaveLength(1)
  })

  it('handles empty incoming array (clears the track)', () => {
    const existing = [w('a', 0, 'sf1'), w('b', 1, 'sf2')]
    const result = mergeTrackWords(existing, [], 'sf1')
    expect(result.map((x) => x.id)).toEqual(['b'])
  })

  it('does not affect words from a different sourceFileId', () => {
    const existing = [w('x', 0, 'sf1'), w('y', 1, 'sf2'), w('z', 2, 'sf1')]
    const incoming = [w('new', 0.5, 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'sf1')
    expect(result.some((r) => r.id === 'y')).toBe(true)
    expect(result.filter((r) => r.sourceFileId === 'sf1').map((r) => r.id)).toEqual(['new'])
  })

  it('is idempotent when called twice with the same incoming', () => {
    const existing = [w('a', 0, 'sf1')]
    const incoming = [w('b', 0, 'sf1')]
    const once  = mergeTrackWords(existing, incoming, 'sf1')
    const twice = mergeTrackWords(once, incoming, 'sf1')
    expect(twice.map((x) => x.id)).toEqual(['b'])
  })
})
