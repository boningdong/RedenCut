// ─────────────────────────────────────────────────────────────────────────────
// Timeline Store — Tier 1 Unit Tests
//
// These tests exercise the pure state/logic layer of timeline.store with no
// browser or Electron dependencies. All assertions run in the Node environment.
//
// Coverage:
//   • source registration and project initialization
//   • clip splitting, muting, and unmuting, including moved clips
//   • undo and redo history, including transcript word IDs
//   • project restoration and clip ordering
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from './timeline.store'
import { useTranscriptStore } from './transcript.store'
import type { RendererAudioSource } from '@shared/session.types'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Reset both stores to a clean state before every test. */
function resetAll() {
  useTimelineStore.getState().reset()
  useTranscriptStore.getState().reset()
}

/** Shorthand to read the current timeline state. */
const tl = () => useTimelineStore.getState()

function managedSource(seed: number, duration: number): RendererAudioSource {
  const id =
    `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}` as RendererAudioSource['id']
  return {
    id,
    displayName: `Source ${seed}`,
    metadata: {
      durationSeconds: duration,
      sampleRate: 44_100,
      channels: 2,
      codec: 'mp3',
      bitrateKbps: 192,
    },
    cache: {
      audioSourceId: id,
      sampleRate: 48_000,
      channels: 2,
      frameCount: duration * 48_000,
      waveformLevels: [],
    },
  }
}

/** Returns the clips of the first (primary) track, sorted by sourceStart. */
function primaryClips() {
  const { tracks } = tl()
  if (tracks.length === 0) return []
  return [...tracks[0].clips].sort((a, b) => a.sourceStart - b.sourceStart)
}

describe('addAudioSource', () => {
  beforeEach(resetAll)

  it('registers a managed AudioSource and returns its id', () => {
    const source = managedSource(1, 10)
    const id = tl().addAudioSource(source)
    expect(id).toBe(source.id)
    expect(tl().audioSources).toEqual([source])
  })

  it('is idempotent — calling twice with the same path does not duplicate', () => {
    const source = managedSource(1, 10)
    tl().addAudioSource(source)
    const id2 = tl().addAudioSource(source)
    expect(id2).toBe(source.id)
    expect(tl().audioSources).toHaveLength(1)
  })

  it('does not push to undoStack', () => {
    tl().addAudioSource(managedSource(1, 10))
    expect(tl().undoStack).toHaveLength(0)
  })
})

describe('splitAt — after moveClip', () => {
  beforeEach(resetAll)

  function moveAndSelectPrimaryClip() {
    tl().initFromAudioSource(managedSource(1, 20))
    const clip = tl().tracks[0].clips[0]
    tl().moveClip(clip.id, 10)
    tl().setSelectedClipId(clip.id)
  }

  it('finds clip using output coordinates, not source coordinates', () => {
    moveAndSelectPrimaryClip()
    tl().splitAt(12)
    expect(tl().tracks[0].clips).toHaveLength(2)
  })

  it('left clip sourceEnd is mapped back to source coordinates', () => {
    moveAndSelectPrimaryClip()
    tl().splitAt(12)
    const leftClip = tl().tracks[0].clips[0]
    expect(leftClip.sourceEnd).toBeCloseTo(2)
    expect(leftClip.outputStart).toBeCloseTo(10)
  })

  it('right clip sourceStart and outputStart are updated correctly', () => {
    moveAndSelectPrimaryClip()
    tl().splitAt(12)
    const rightClip = tl().tracks[0].clips[1]
    expect(rightClip.sourceStart).toBeCloseTo(2)
    expect(rightClip.outputStart).toBeCloseTo(12)
  })

  it('is a no-op when time is at exactly the clip boundary (not strictly inside)', () => {
    moveAndSelectPrimaryClip()
    const stackBefore = tl().undoStack.length
    tl().splitAt(10)
    expect(tl().tracks[0].clips).toHaveLength(1)
    expect(tl().undoStack.length).toBe(stackBefore)
  })
})

describe('addAudioSource — same id', () => {
  beforeEach(resetAll)

  it('does not replace metadata when the identity is already registered', () => {
    tl().addAudioSource(managedSource(1, 10))
    tl().addAudioSource(managedSource(1, 99))
    expect(tl().audioSources[0].metadata.durationSeconds).toBe(10)
  })
})

// ── Test helpers ───────────────────────────────────────────────────────────────

/** Create a simple Word object for use in transcript tests. */
function makeWord(id: string, start: number, end: number, muted = false) {
  return { id, text: id, start, end, muted }
}

// ══════════════════════════════════════════════════════════════════════════════
// initFromAudioSource
// ══════════════════════════════════════════════════════════════════════════════

describe('initFromAudioSource', () => {
  beforeEach(resetAll)

  it('creates one source file with the given path and duration', () => {
    const source = managedSource(1, 100)
    tl().initFromAudioSource(source)
    expect(tl().audioSources).toEqual([source])
  })

  it('creates one track with one clip spanning the full duration', () => {
    tl().initFromAudioSource(managedSource(1, 120))
    const { tracks } = tl()
    expect(tracks).toHaveLength(1)
    const clips = tracks[0].clips
    expect(clips).toHaveLength(1)
    expect(clips[0].sourceStart).toBe(0)
    expect(clips[0].sourceEnd).toBe(120)
    expect(clips[0].outputStart).toBe(0)
    expect(clips[0].muted).toBe(false)
  })

  it('clears the undo stack on each call', () => {
    tl().initFromAudioSource(managedSource(1, 60))
    tl().setSelectedClipId(tl().tracks[0].clips[0].id)
    tl().splitAt(30)
    expect(tl().undoStack).toHaveLength(1)

    tl().initFromAudioSource(managedSource(2, 60))
    expect(tl().undoStack).toHaveLength(0)
  })

  it('clears selectedClipId', () => {
    tl().initFromAudioSource(managedSource(1, 60))
    tl().setSelectedClipId(tl().tracks[0].clips[0].id)
    tl().initFromAudioSource(managedSource(1, 60))
    expect(tl().selectedClipId).toBeNull()
  })

  it('clears history and both selections when starting a new source session', () => {
    const staleHistory = { before: [], wordIds: [], label: 'stale edit' }
    useTimelineStore.setState({
      undoStack: [staleHistory],
      redoStack: [staleHistory],
      selectedTrackId: 'stale-track',
      selectedClipId: 'stale-clip',
    })

    tl().initFromAudioSource(managedSource(1, 60))

    expect(tl().undoStack).toEqual([])
    expect(tl().redoStack).toEqual([])
    expect(tl().selectedTrackId).toBeNull()
    expect(tl().selectedClipId).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// splitAt
// ══════════════════════════════════════════════════════════════════════════════

describe('splitAt', () => {
  beforeEach(() => {
    resetAll()
    tl().initFromAudioSource(managedSource(1, 100))
  })

  it('splits the clip at the given time', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(40)
    const clips = primaryClips()
    expect(clips).toHaveLength(2)
    expect(clips[0].sourceStart).toBe(0)
    expect(clips[0].sourceEnd).toBe(40)
    expect(clips[1].sourceStart).toBe(40)
    expect(clips[1].sourceEnd).toBe(100)
  })

  it('preserves outputStart = sourceStart after a simple split', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    const clips = primaryClips()
    expect(clips[0].outputStart).toBe(0)
    expect(clips[1].outputStart).toBe(50)
  })

  it('pushes an entry onto the undo stack', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(25)
    expect(tl().undoStack).toHaveLength(1)
    expect(tl().undoStack[0].label).toContain('split')
  })

  it('does nothing when time is at the start boundary (strict <)', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(0)
    expect(primaryClips()).toHaveLength(1)
    expect(tl().undoStack).toHaveLength(0)
  })

  it('does nothing when time is at the end boundary (strict <)', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(100)
    expect(primaryClips()).toHaveLength(1)
    expect(tl().undoStack).toHaveLength(0)
  })

  it('does nothing when time falls outside all clips', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(150)
    expect(primaryClips()).toHaveLength(1)
    expect(tl().undoStack).toHaveLength(0)
  })

  it('can split a previously split clip', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(40)
    // After first split, select the second clip (40–100) and split at 70
    const secondClip = primaryClips().find((c) => c.sourceStart === 40)!
    tl().setSelectedClipId(secondClip.id)
    tl().splitAt(70)
    const clips = primaryClips()
    expect(clips).toHaveLength(3)
    expect(clips[0].sourceEnd).toBe(40)
    expect(clips[1].sourceStart).toBe(40)
    expect(clips[1].sourceEnd).toBe(70)
    expect(clips[2].sourceStart).toBe(70)
    expect(clips[2].sourceEnd).toBe(100)
  })
})

/** Returns the track ID of the primary (first) track. */
function primaryTrackId() {
  const { tracks } = tl()
  if (tracks.length === 0) throw new Error('No tracks')
  return tracks[0].id
}

// ══════════════════════════════════════════════════════════════════════════════
// muteRange
// ══════════════════════════════════════════════════════════════════════════════

describe('muteRange', () => {
  beforeEach(() => {
    resetAll()
    tl().initFromAudioSource(managedSource(1, 100))
  })

  it('creates a muted clip in the middle of an unmuted clip', () => {
    tl().muteRange(primaryTrackId(), 20, 60)
    const clips = primaryClips()
    // Expected: [0–20 unmuted] [20–60 muted] [60–100 unmuted]
    expect(clips).toHaveLength(3)
    const muted = clips.find((c) => c.muted)
    expect(muted).toBeDefined()
    expect(muted!.sourceStart).toBe(20)
    expect(muted!.sourceEnd).toBe(60)
  })

  it('produces only two clips when muting from the start', () => {
    tl().muteRange(primaryTrackId(), 0, 30)
    const clips = primaryClips()
    expect(clips).toHaveLength(2)
    expect(clips[0].muted).toBe(true)
    expect(clips[0].sourceStart).toBe(0)
    expect(clips[0].sourceEnd).toBe(30)
    expect(clips[1].muted).toBe(false)
    expect(clips[1].sourceStart).toBe(30)
  })

  it('produces only two clips when muting to the end', () => {
    tl().muteRange(primaryTrackId(), 70, 100)
    const clips = primaryClips()
    expect(clips).toHaveLength(2)
    expect(clips[0].muted).toBe(false)
    expect(clips[1].muted).toBe(true)
    expect(clips[1].sourceEnd).toBe(100)
  })

  it('pushes to undo stack with the mute range label', () => {
    tl().muteRange(primaryTrackId(), 10, 50)
    expect(tl().undoStack).toHaveLength(1)
    expect(tl().undoStack[0].label).toContain('mute')
  })

  it('stores wordIds in the undo entry and mutes them in transcript store', () => {
    useTranscriptStore
      .getState()
      .setWords([makeWord('w1', 22, 30), makeWord('w2', 35, 45), makeWord('w3', 80, 90)])
    tl().muteRange(primaryTrackId(), 20, 60, ['w1', 'w2'])
    // Undo stack should carry the word IDs
    expect(tl().undoStack[0].wordIds).toEqual(['w1', 'w2'])
    // Transcript store should reflect the mute
    const { words } = useTranscriptStore.getState()
    expect(words.find((w) => w.id === 'w1')!.muted).toBe(true)
    expect(words.find((w) => w.id === 'w2')!.muted).toBe(true)
    expect(words.find((w) => w.id === 'w3')!.muted).toBe(false)
  })

  it('does nothing when trackId is not registered', () => {
    tl().muteRange('unknown-track-id', 10, 50)
    expect(primaryClips()).toHaveLength(1)
    expect(tl().undoStack).toHaveLength(0)
  })

  it('does not create history when the output range misses every clip', () => {
    tl().muteRange(primaryTrackId(), 200, 210)
    expect(tl().undoStack).toHaveLength(0)
  })

  it('maps an output-time mute range back into a moved clip source range', () => {
    const clip = primaryClips()[0]
    tl().moveClip(clip.id, 10)
    tl().muteRange(primaryTrackId(), 12, 15)
    const muted = primaryClips().find((candidate) => candidate.muted)
    expect(muted).toMatchObject({ sourceStart: 2, sourceEnd: 5, outputStart: 12 })
  })

  it('keeps all clips contiguous (no gaps) after muting', () => {
    tl().muteRange(primaryTrackId(), 30, 70)
    const clips = primaryClips().sort((a, b) => a.sourceStart - b.sourceStart)
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].sourceStart).toBeCloseTo(clips[i - 1].sourceEnd, 6)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// unmuteClip
// ══════════════════════════════════════════════════════════════════════════════

describe('unmuteClip', () => {
  beforeEach(() => {
    resetAll()
    tl().initFromAudioSource(managedSource(1, 100))
  })

  it('unmutes a muted clip by ID', () => {
    tl().muteRange(primaryTrackId(), 20, 60)
    const mutedClip = primaryClips().find((c) => c.muted)!
    tl().unmuteClip(mutedClip.id)
    expect(primaryClips().every((c) => !c.muted)).toBe(true)
  })

  it('merges adjacent unmuted clips after unmuting', () => {
    tl().muteRange(primaryTrackId(), 20, 60)
    const mutedClip = primaryClips().find((c) => c.muted)!
    tl().unmuteClip(mutedClip.id)
    // After unmute + merge the three clips should collapse back to one
    expect(primaryClips()).toHaveLength(1)
    expect(primaryClips()[0].sourceStart).toBe(0)
    expect(primaryClips()[0].sourceEnd).toBe(100)
  })

  it('unmutes transcript words when wordIds are provided', () => {
    useTranscriptStore
      .getState()
      .setWords([makeWord('w1', 22, 30, true), makeWord('w2', 35, 45, true)])
    tl().muteRange(primaryTrackId(), 20, 60, ['w1', 'w2'])
    const mutedClip = primaryClips().find((c) => c.muted)!
    tl().unmuteClip(mutedClip.id)
    const { words } = useTranscriptStore.getState()
    // After unmute the words should be un-muted
    expect(words.find((w) => w.id === 'w1')!.muted).toBe(false)
    expect(words.find((w) => w.id === 'w2')!.muted).toBe(false)
  })

  it('clears selectedClipId', () => {
    tl().muteRange(primaryTrackId(), 20, 60)
    const mutedClip = primaryClips().find((c) => c.muted)!
    tl().setSelectedClipId(mutedClip.id)
    tl().unmuteClip(mutedClip.id)
    expect(tl().selectedClipId).toBeNull()
  })

  it('does nothing when clipId does not exist', () => {
    const before = primaryClips().length
    tl().unmuteClip('nonexistent-clip')
    expect(primaryClips()).toHaveLength(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// undo
// ══════════════════════════════════════════════════════════════════════════════

describe('undo', () => {
  beforeEach(() => {
    resetAll()
    tl().initFromAudioSource(managedSource(1, 100))
  })

  it('reverts a split operation', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    expect(primaryClips()).toHaveLength(2)
    tl().undo()
    expect(primaryClips()).toHaveLength(1)
    expect(primaryClips()[0].sourceStart).toBe(0)
    expect(primaryClips()[0].sourceEnd).toBe(100)
  })

  it('reverts a muteRange operation', () => {
    tl().muteRange(primaryTrackId(), 20, 60)
    tl().undo()
    expect(primaryClips()).toHaveLength(1)
    expect(primaryClips()[0].muted).toBe(false)
  })

  it('unmutes transcript words when undoing a mute', () => {
    useTranscriptStore.getState().setWords([makeWord('w1', 22, 30), makeWord('w2', 35, 45)])
    tl().muteRange(primaryTrackId(), 20, 60, ['w1', 'w2'])
    tl().undo()
    const { words } = useTranscriptStore.getState()
    expect(words.find((w) => w.id === 'w1')!.muted).toBe(false)
    expect(words.find((w) => w.id === 'w2')!.muted).toBe(false)
  })

  it('pops the undo stack on each call', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(30)
    const secondClip = primaryClips().find((c) => c.sourceStart === 30)!
    tl().setSelectedClipId(secondClip.id)
    tl().splitAt(60)
    expect(tl().undoStack).toHaveLength(2)
    tl().undo()
    expect(tl().undoStack).toHaveLength(1)
    tl().undo()
    expect(tl().undoStack).toHaveLength(0)
  })

  it('is a no-op when the undo stack is empty', () => {
    expect(() => tl().undo()).not.toThrow()
    expect(primaryClips()).toHaveLength(1)
  })

  it('reverts multiple operations in LIFO order', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(40) // op 1: [0–40][40–100]
    tl().muteRange(primaryTrackId(), 60, 80) // op 2: [0–40][40–60][60–80 muted][80–100]
    tl().undo() // undo op 2
    expect(primaryClips()).toHaveLength(2)
    tl().undo() // undo op 1
    expect(primaryClips()).toHaveLength(1)
  })

  it('clears selectedClipId after undo', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().undo()
    expect(tl().selectedClipId).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// redo
// ══════════════════════════════════════════════════════════════════════════════

describe('redo', () => {
  beforeEach(() => {
    resetAll()
    tl().initFromAudioSource(managedSource(1, 100))
  })

  it('re-applies a split that was undone', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    tl().undo()
    expect(primaryClips()).toHaveLength(1)
    tl().redo()
    expect(primaryClips()).toHaveLength(2)
    expect(primaryClips()[0].sourceEnd).toBe(50)
    expect(primaryClips()[1].sourceStart).toBe(50)
  })

  it('re-applies a muteRange that was undone', () => {
    tl().muteRange(primaryTrackId(), 20, 60)
    tl().undo()
    expect(primaryClips().every((c) => !c.muted)).toBe(true)
    tl().redo()
    const muted = primaryClips().find((c) => c.muted)
    expect(muted).toBeDefined()
    expect(muted!.sourceStart).toBe(20)
    expect(muted!.sourceEnd).toBe(60)
  })

  it('re-mutes transcript words when redoing a mute operation', () => {
    useTranscriptStore.getState().setWords([makeWord('w1', 22, 30), makeWord('w2', 35, 45)])
    tl().muteRange(primaryTrackId(), 20, 60, ['w1', 'w2'])
    tl().undo()
    expect(useTranscriptStore.getState().words.find((w) => w.id === 'w1')!.muted).toBe(false)
    tl().redo()
    expect(useTranscriptStore.getState().words.find((w) => w.id === 'w1')!.muted).toBe(true)
    expect(useTranscriptStore.getState().words.find((w) => w.id === 'w2')!.muted).toBe(true)
  })

  it('is a no-op when the redo stack is empty', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    expect(() => tl().redo()).not.toThrow()
    expect(primaryClips()).toHaveLength(2)
  })

  it('clears the redo stack when a new mutation is made after undo', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    tl().undo()
    expect(tl().redoStack).toHaveLength(1)

    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(30)
    expect(tl().redoStack).toHaveLength(0)

    tl().redo() // no-op now
    expect(primaryClips()).toHaveLength(2) // only the new split at 30
  })

  it('supports undo/redo cycling multiple times', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    for (let i = 0; i < 3; i++) {
      tl().undo()
      expect(primaryClips()).toHaveLength(1)
      tl().redo()
      expect(primaryClips()).toHaveLength(2)
    }
  })

  it('pushes a redo entry back to undoStack (enabling undo after redo)', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(50)
    tl().undo()
    tl().redo()
    expect(tl().undoStack).toHaveLength(1)
    tl().undo()
    expect(primaryClips()).toHaveLength(1)
  })

  it('multiple undos followed by multiple redos restores in correct order', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(30) // op1: [0–30][30–100]
    const secondClip = primaryClips().find((c) => c.sourceStart === 30)!
    tl().setSelectedClipId(secondClip.id)
    tl().splitAt(70) // op2: [0–30][30–70][70–100]
    tl().undo() // undo op2
    tl().undo() // undo op1
    expect(primaryClips()).toHaveLength(1)

    tl().redo() // redo op1
    expect(primaryClips()).toHaveLength(2)
    tl().redo() // redo op2
    expect(primaryClips()).toHaveLength(3)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// loadFromProject
// ══════════════════════════════════════════════════════════════════════════════

describe('loadFromProject', () => {
  beforeEach(resetAll)

  it('restores tracks and source files without affecting undo stack', () => {
    const audioSources = [managedSource(1, 60)]
    const tracks = [
      {
        id: 't1',
        name: 'Track 1',
        clips: [
          {
            id: 'c1',
            trackId: 't1',
            audioSourceId: audioSources[0].id,
            sourceStart: 0,
            sourceEnd: 60,
            outputStart: 0,
            gain: 1,
            muted: false,
            effects: [],
          },
        ],
        volume: 1,
        muted: false,
        solo: false,
        color: '#fff',
        effects: [],
      },
    ]
    tl().loadFromProject(audioSources, tracks)
    expect(tl().audioSources).toEqual(audioSources)
    expect(tl().tracks).toEqual(tracks)
    expect(tl().undoStack).toHaveLength(0)
  })

  it('clears history and both selections when loading another project', () => {
    const staleHistory = { before: [], wordIds: [], label: 'stale edit' }
    useTimelineStore.setState({
      undoStack: [staleHistory],
      redoStack: [staleHistory],
      selectedTrackId: 'stale-track',
      selectedClipId: 'stale-clip',
    })

    tl().loadFromProject([managedSource(1, 60)], [])

    expect(tl().undoStack).toEqual([])
    expect(tl().redoStack).toEqual([])
    expect(tl().selectedTrackId).toBeNull()
    expect(tl().selectedClipId).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// getAllClips
// ══════════════════════════════════════════════════════════════════════════════

describe('getAllClips', () => {
  beforeEach(() => {
    resetAll()
    tl().initFromAudioSource(managedSource(1, 100))
  })

  it('returns clips sorted by outputStart', () => {
    tl().setSelectedClipId(primaryClips()[0].id)
    tl().splitAt(40)
    const midClip = primaryClips().find((c) => c.sourceStart === 40)!
    tl().setSelectedClipId(midClip.id)
    tl().splitAt(70)
    const all = tl().getAllClips()
    for (let i = 1; i < all.length; i++) {
      expect(all[i].outputStart).toBeGreaterThanOrEqual(all[i - 1].outputStart)
    }
  })

  it('includes clips from all tracks', () => {
    const secondSource = managedSource(2, 60)
    const { audioSources, tracks } = tl()
    // Manually add a second source + track for this test
    tl().loadFromProject(
      [...audioSources, secondSource],
      [
        ...tracks,
        {
          id: 't2',
          name: 'Track 2',
          clips: [
            {
              id: 'c-bg',
              trackId: 't2',
              audioSourceId: secondSource.id,
              sourceStart: 0,
              sourceEnd: 60,
              outputStart: 0,
              gain: 1,
              muted: false,
              effects: [],
            },
          ],
          volume: 1,
          muted: false,
          solo: false,
          color: '#f00',
          effects: [],
        },
      ],
    )
    expect(tl().getAllClips()).toHaveLength(2)
  })
})

describe('occurrence-scoped transcript muting', () => {
  beforeEach(resetAll)

  it('mutes only the selected moved clip and groups source ranges into one undo action', () => {
    const source = managedSource(501, 20)
    tl().addAudioSource(source)
    const trackId = tl().addTrack(undefined, source.id)
    const otherTrackId = tl().addTrack(undefined, source.id)
    const original = tl().tracks[0].clips[0]
    const chosen = { ...original, id: 'chosen', sourceStart: 4, sourceEnd: 12, outputStart: 30 }
    useTimelineStore.setState({
      tracks: tl().tracks.map((track) =>
        track.id === trackId ? { ...track, clips: [original, chosen] } : track,
      ),
    })
    const before = tl().tracks
    tl().muteClipRanges(trackId, 'chosen', [
      { start: 5, end: 6 },
      { start: 8, end: 10 },
    ])
    expect(tl().tracks[0].clips.find((clip) => clip.id === original.id)).toBe(original)
    expect(tl().tracks.find((track) => track.id === otherTrackId)).toBe(before[1])
    expect(
      tl()
        .tracks[0].clips.filter((clip) => clip.muted)
        .map((clip) => [clip.sourceStart, clip.sourceEnd, clip.outputStart]),
    ).toEqual([
      [5, 6, 31],
      [8, 10, 34],
    ])
    expect(tl().undoStack).toHaveLength(1)
    const edited = tl().tracks
    tl().undo()
    expect(tl().tracks).toEqual(before)
    tl().redo()
    expect(tl().tracks).toEqual(edited)
  })

  it('ignores stale identities and invalid ranges; clamps overlapping ranges to the chosen clip', () => {
    const source = managedSource(502, 10)
    tl().addAudioSource(source)
    const trackId = tl().addTrack(undefined, source.id)
    const clip = tl().tracks[0].clips[0]
    for (const ranges of [
      [],
      [{ start: NaN, end: 2 }],
      [{ start: 5, end: 2 }],
      [{ start: 12, end: 15 }],
    ])
      tl().muteClipRanges(trackId, clip.id, ranges)
    tl().muteClipRanges('missing', clip.id, [{ start: 0, end: 1 }])
    tl().muteClipRanges(trackId, 'missing', [{ start: 0, end: 1 }])
    expect(tl().undoStack).toHaveLength(0)
    tl().muteClipRanges(trackId, clip.id, [
      { start: -2, end: 2 },
      { start: 1, end: 4 },
    ])
    expect(
      tl()
        .tracks[0].clips.filter((item) => item.muted)
        .map((item) => [item.sourceStart, item.sourceEnd]),
    ).toEqual([[0, 4]])
    expect(tl().undoStack).toHaveLength(1)
    const muted = tl().tracks[0].clips[0]
    tl().muteClipRanges(trackId, muted.id, [{ start: 0, end: 4 }])
    expect(tl().undoStack).toHaveLength(1)
  })
})
