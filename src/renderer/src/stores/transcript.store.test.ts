// ─────────────────────────────────────────────────────────────────────────────
// Transcript Store — Tier 1 Unit Tests
//
// Pure state/logic tests with no browser or Electron dependencies.
//
// Coverage:
//   • word list, mute state, and timestamp changes
//   • track visibility and track-word removal
//   • selection, display preferences, and reset
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from './transcript.store'
import type { Word } from '@shared/project.types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore() {
  useTranscriptStore.getState().reset()
}

const ts = () => useTranscriptStore.getState()

function makeWord(id: string, start: number, end: number, muted = false): Word {
  return { id, text: id, start, end, muted }
}

function seedWords() {
  ts().setWords([
    makeWord('w1', 0, 5),
    makeWord('w2', 5, 10),
    makeWord('w3', 10, 20),
    makeWord('w4', 20, 30),
  ])
}

describe('toggleTrackVisibility', () => {
  beforeEach(resetStore)

  it('adds a track that is not yet visible', () => {
    ts().toggleTrackVisibility('t1')
    expect(ts().visibleTrackIds).toContain('t1')
  })

  it('removes a track that is already visible', () => {
    ts().toggleTrackVisibility('t1')
    ts().toggleTrackVisibility('t1')
    expect(ts().visibleTrackIds).not.toContain('t1')
  })

  it('toggling one track does not affect another', () => {
    ts().toggleTrackVisibility('t1')
    ts().toggleTrackVisibility('t2')
    ts().toggleTrackVisibility('t1')
    expect(ts().visibleTrackIds).not.toContain('t1')
    expect(ts().visibleTrackIds).toContain('t2')
  })
})

describe('ensureTrackVisible', () => {
  beforeEach(resetStore)

  it('adds track when absent', () => {
    ts().ensureTrackVisible('t1')
    expect(ts().visibleTrackIds).toContain('t1')
  })

  it('is idempotent — calling twice does not duplicate the id', () => {
    ts().ensureTrackVisible('t1')
    ts().ensureTrackVisible('t1')
    expect(ts().visibleTrackIds.filter((id) => id === 't1')).toHaveLength(1)
  })
})

describe('removeWordsForTrack', () => {
  beforeEach(resetStore)

  function setWordsForTwoTracks() {
    ts().setWords([
      { ...makeWord('w1', 0, 1), trackId: 't1' },
      { ...makeWord('w2', 1, 2), trackId: 't2' },
    ])
  }

  it('removes words belonging to the track', () => {
    setWordsForTwoTracks()
    ts().removeWordsForTrack('t1')
    expect(ts().words).toHaveLength(1)
    expect(ts().words[0].id).toBe('w2')
  })

  it('removes both the track id from visibleTrackIds and its words atomically', () => {
    setWordsForTwoTracks()
    ts().ensureTrackVisible('t1')
    ts().ensureTrackVisible('t2')
    ts().removeWordsForTrack('t1')
    expect(ts().visibleTrackIds).not.toContain('t1')
    expect(ts().visibleTrackIds).toContain('t2')
    expect(ts().words.some((word) => word.trackId === 't1')).toBe(false)
  })

  it('leaves other words untouched', () => {
    setWordsForTwoTracks()
    ts().removeWordsForTrack('t1')
    expect(ts().words[0].trackId).toBe('t2')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// setWords
// ══════════════════════════════════════════════════════════════════════════════

describe('setWords', () => {
  beforeEach(resetStore)

  it('replaces the word list', () => {
    ts().setWords([makeWord('w1', 0, 5)])
    expect(ts().words).toHaveLength(1)
    expect(ts().words[0].id).toBe('w1')
  })

  it('replaces an existing list with a new one', () => {
    ts().setWords([makeWord('w1', 0, 5), makeWord('w2', 5, 10)])
    ts().setWords([makeWord('x1', 0, 3)])
    expect(ts().words).toHaveLength(1)
    expect(ts().words[0].id).toBe('x1')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// muteWords / unmuteWords
// ══════════════════════════════════════════════════════════════════════════════

describe('muteWords', () => {
  beforeEach(() => {
    resetStore()
    seedWords()
  })

  it('marks the specified words as muted', () => {
    ts().muteWords(['w1', 'w3'])
    const { words } = ts()
    expect(words.find((w) => w.id === 'w1')!.muted).toBe(true)
    expect(words.find((w) => w.id === 'w2')!.muted).toBe(false) // untouched
    expect(words.find((w) => w.id === 'w3')!.muted).toBe(true)
  })

  it('does not affect words not in the ID list', () => {
    ts().muteWords(['w2'])
    expect(ts().words.filter((w) => w.muted)).toHaveLength(1)
  })

  it('is idempotent (muting an already-muted word keeps it muted)', () => {
    ts().muteWords(['w1'])
    ts().muteWords(['w1'])
    expect(ts().words.find((w) => w.id === 'w1')!.muted).toBe(true)
  })

  it('handles an empty list without error', () => {
    expect(() => ts().muteWords([])).not.toThrow()
  })
})

describe('unmuteWords', () => {
  beforeEach(() => {
    resetStore()
    ts().setWords([
      makeWord('w1', 0, 5, true),
      makeWord('w2', 5, 10, true),
      makeWord('w3', 10, 20, false),
    ])
  })

  it('marks the specified words as unmuted', () => {
    ts().unmuteWords(['w1'])
    expect(ts().words.find((w) => w.id === 'w1')!.muted).toBe(false)
    expect(ts().words.find((w) => w.id === 'w2')!.muted).toBe(true) // untouched
  })

  it('does not affect words not in the ID list', () => {
    ts().unmuteWords(['w1'])
    expect(ts().words.filter((w) => w.muted)).toHaveLength(1)
    expect(ts().words.find((w) => w.muted)!.id).toBe('w2')
  })

  it('is idempotent', () => {
    ts().unmuteWords(['w3']) // already unmuted
    expect(ts().words.find((w) => w.id === 'w3')!.muted).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// setWordMuted
// ══════════════════════════════════════════════════════════════════════════════

describe('setWordMuted', () => {
  beforeEach(() => {
    resetStore()
    seedWords()
  })

  it('mutes a single word by ID', () => {
    ts().setWordMuted('w2', true)
    expect(ts().words.find((w) => w.id === 'w2')!.muted).toBe(true)
  })

  it('unmutes a single word by ID', () => {
    ts().muteWords(['w2'])
    ts().setWordMuted('w2', false)
    expect(ts().words.find((w) => w.id === 'w2')!.muted).toBe(false)
  })

  it('does not affect other words', () => {
    ts().setWordMuted('w2', true)
    expect(ts().words.filter((w) => w.muted)).toHaveLength(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// shiftTimestamps
// ══════════════════════════════════════════════════════════════════════════════

describe('shiftTimestamps', () => {
  beforeEach(() => {
    resetStore()
    seedWords()
  })

  it('shifts all word timestamps by a positive offset', () => {
    ts().shiftTimestamps(2)
    const { words } = ts()
    expect(words[0].start).toBe(2)
    expect(words[0].end).toBe(7)
    expect(words[1].start).toBe(7)
    expect(words[3].end).toBe(32)
  })

  it('shifts all word timestamps by a negative offset', () => {
    ts().shiftTimestamps(-2)
    const { words } = ts()
    // w1: start=0-2=-2 → clamped to 0; end=5-2=3
    expect(words[0].start).toBe(0)
    expect(words[0].end).toBe(3)
    // w3: start=10-2=8, end=20-2=18
    expect(words[2].start).toBe(8)
    expect(words[2].end).toBe(18)
  })

  it('clamps timestamps to 0 (never negative)', () => {
    ts().shiftTimestamps(-999)
    const { words } = ts()
    for (const word of words) {
      expect(word.start).toBeGreaterThanOrEqual(0)
      expect(word.end).toBeGreaterThanOrEqual(0)
    }
  })

  it('is a no-op when offset is 0', () => {
    const before = ts().words.map((w) => ({ ...w }))
    ts().shiftTimestamps(0)
    ts().words.forEach((w, i) => {
      expect(w.start).toBe(before[i].start)
      expect(w.end).toBe(before[i].end)
    })
  })

  it('works on an empty word list without error', () => {
    ts().setWords([])
    expect(() => ts().shiftTimestamps(5)).not.toThrow()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// toggleShowMutedWords
// ══════════════════════════════════════════════════════════════════════════════

describe('toggleShowMutedWords', () => {
  beforeEach(resetStore)

  it('starts as true', () => {
    expect(ts().showMutedWords).toBe(true)
  })

  it('toggles to false then back to true', () => {
    ts().toggleShowMutedWords()
    expect(ts().showMutedWords).toBe(false)
    ts().toggleShowMutedWords()
    expect(ts().showMutedWords).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// selection helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('selectedWordIds', () => {
  beforeEach(resetStore)

  it('setSelectedWordIds replaces the selection set', () => {
    ts().setSelectedWordIds(new Set(['w1', 'w2']))
    expect(ts().selectedWordIds.has('w1')).toBe(true)
    expect(ts().selectedWordIds.has('w2')).toBe(true)
  })

  it('clearSelection empties the set', () => {
    ts().setSelectedWordIds(new Set(['w1']))
    ts().clearSelection()
    expect(ts().selectedWordIds.size).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// reset
// ══════════════════════════════════════════════════════════════════════════════

describe('reset', () => {
  beforeEach(resetStore)

  it('restores all initial values', () => {
    ts().setWords([makeWord('w1', 0, 5, true)])
    ts().toggleShowMutedWords() // now false
    ts().setSelectedWordIds(new Set(['w1']))
    ts().setIsGenerating(true)
    ts().setGeneratingStatus('loading…')

    ts().reset()

    expect(ts().words).toHaveLength(0)
    expect(ts().showMutedWords).toBe(true)
    expect(ts().selectedWordIds.size).toBe(0)
    expect(ts().isGenerating).toBe(false)
    expect(ts().generatingStatus).toBe('')
  })
})
