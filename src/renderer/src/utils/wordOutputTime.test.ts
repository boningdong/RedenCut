import { describe, it, expect } from 'vitest'
import { getWordOutputTime } from './wordOutputTime'
import type { Word, Track } from '@shared/ProjectTypes'

const mkWord = (overrides: Partial<Word> = {}): Word => ({
  id: 'w0',
  text: 'hello',
  start: 0,
  end: 0.5,
  muted: false,
  trackId: 'track1',
  audioSourceId: '00000000-0000-4000-8000-000000000001' as Word['audioSourceId'],
  ...overrides,
})

const mkTrack = (clips: Track['clips']): Track => ({
  id: 'track1',
  name: 'Track 1',
  color: '#6366f1',
  muted: false,
  solo: false,
  volume: 1,
  effects: [],
  clips,
})

const mkClip = (overrides: Partial<Track['clips'][0]> = {}): Track['clips'][0] => ({
  id: 'c1',
  trackId: 'track1',
  audioSourceId: '00000000-0000-4000-8000-000000000001' as Track['clips'][0]['audioSourceId'],
  sourceStart: 0,
  sourceEnd: 10,
  outputStart: 0,
  gain: 1,
  muted: false,
  effects: [],
  ...overrides,
})

describe('getWordOutputTime', () => {
  it('returns source time for legacy words (no trackId)', () => {
    const word = mkWord({ trackId: undefined, start: 3 })
    expect(getWordOutputTime(word, [])).toBe(3)
  })

  it('returns source time when track not found', () => {
    const word = mkWord({ trackId: 'missing', start: 2 })
    expect(getWordOutputTime(word, [])).toBe(2)
  })

  it('returns source time when no clip covers word.start', () => {
    const track = mkTrack([mkClip({ sourceStart: 5, sourceEnd: 10 })])
    const word = mkWord({ start: 3 }) // outside clip range
    expect(getWordOutputTime(word, [track])).toBe(3)
  })

  it('returns outputStart + offset when clip aligns with source', () => {
    // clip: source 0→10, output 0→10 (no repositioning)
    const track = mkTrack([mkClip({ sourceStart: 0, sourceEnd: 10, outputStart: 0 })])
    const word = mkWord({ start: 4 })
    expect(getWordOutputTime(word, [track])).toBe(4)
  })

  it('applies outputStart offset when clip has been repositioned', () => {
    // clip moved: source 0→10 now plays at output 20→30
    const track = mkTrack([mkClip({ sourceStart: 0, sourceEnd: 10, outputStart: 20 })])
    const word = mkWord({ start: 3 })
    expect(getWordOutputTime(word, [track])).toBe(23) // 20 + (3 - 0)
  })

  it('handles non-zero sourceStart offset', () => {
    // clip: source 5→15, output 0→10 (first 5s of source trimmed)
    const track = mkTrack([mkClip({ sourceStart: 5, sourceEnd: 15, outputStart: 0 })])
    const word = mkWord({ start: 7 })
    expect(getWordOutputTime(word, [track])).toBe(2) // 0 + (7 - 5)
  })

  it('matches clip by audioSourceId when word has one', () => {
    const clipA = mkClip({
      id: 'cA',
      audioSourceId: '00000000-0000-4000-8000-000000000001' as Track['clips'][0]['audioSourceId'],
      sourceStart: 0,
      sourceEnd: 5,
      outputStart: 0,
    })
    const clipB = mkClip({
      id: 'cB',
      audioSourceId: '00000000-0000-4000-8000-000000000002' as Track['clips'][0]['audioSourceId'],
      sourceStart: 0,
      sourceEnd: 5,
      outputStart: 10,
    })
    const track = mkTrack([clipA, clipB])
    const word = mkWord({
      start: 2,
      audioSourceId: '00000000-0000-4000-8000-000000000002' as Word['audioSourceId'],
    })
    expect(getWordOutputTime(word, [track])).toBe(12) // 10 + (2 - 0)
  })
})
