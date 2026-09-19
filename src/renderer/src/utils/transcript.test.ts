import { describe, it, expect } from 'vitest'
import { mergeTrackWords } from './transcript'
import type { Word } from '@shared/ProjectTypes'

// Minimal word factory
const w = (id: string, start: number, trackId?: string, audioSourceId?: string): Word => ({
  id,
  text: id,
  start,
  end: start + 1,
  muted: false,
  audioSourceId: audioSourceId as Word['audioSourceId'],
  trackId,
})

describe('mergeTrackWords', () => {
  it('replaces existing words for the given trackId', () => {
    const existing = [w('a', 0, 'track1', 'sf1'), w('b', 2, 'track2', 'sf2')]
    const incoming = [w('c', 1, 'track1', 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'track1')
    // track1 words replaced by incoming; track2 word kept; sorted by start
    expect(result.map((x) => x.id)).toEqual(['c', 'b'])
  })

  it('sorts the result by start time', () => {
    const existing = [w('a', 5, 'track1', 'sf1'), w('b', 1, 'track2', 'sf2')]
    const incoming = [w('c', 3, 'track1', 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'track1')
    expect(result.map((x) => x.start)).toEqual([1, 3])
  })

  it('preserves untracked words when no audio source identity is provided', () => {
    const existing = [w('legacy', 0, undefined, undefined)]
    const incoming = [w('new', 1, 'track1', 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'track1')
    expect(result.some((x) => x.id === 'legacy')).toBe(true)
  })

  it('removes untracked words by audioSourceId when a source id is provided', () => {
    const existing = [w('legacy', 0, undefined, 'sf1')]
    const incoming = [w('new', 1, 'track1', 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'track1', 'sf1')
    expect(result.some((x) => x.id === 'legacy')).toBe(false)
    expect(result.some((x) => x.id === 'new')).toBe(true)
  })

  it('handles empty existing array', () => {
    const result = mergeTrackWords([], [w('a', 0, 'track1', 'sf1')], 'track1')
    expect(result).toHaveLength(1)
  })

  it('handles empty incoming array (clears the track)', () => {
    const existing = [w('a', 0, 'track1', 'sf1'), w('b', 1, 'track2', 'sf2')]
    const result = mergeTrackWords(existing, [], 'track1')
    expect(result.map((x) => x.id)).toEqual(['b'])
  })

  it('does not affect words from a different trackId', () => {
    const existing = [
      w('x', 0, 'track1', 'sf1'),
      w('y', 1, 'track2', 'sf2'),
      w('z', 2, 'track1', 'sf1'),
    ]
    const incoming = [w('new', 0.5, 'track1', 'sf1')]
    const result = mergeTrackWords(existing, incoming, 'track1')
    expect(result.some((r) => r.id === 'y')).toBe(true)
    expect(result.filter((r) => r.trackId === 'track1').map((r) => r.id)).toEqual(['new'])
  })

  it('is idempotent when called twice with the same incoming', () => {
    const existing = [w('a', 0, 'track1', 'sf1')]
    const incoming = [w('b', 0, 'track1', 'sf1')]
    const once = mergeTrackWords(existing, incoming, 'track1')
    const twice = mergeTrackWords(once, incoming, 'track1')
    expect(twice.map((x) => x.id)).toEqual(['b'])
  })
})
