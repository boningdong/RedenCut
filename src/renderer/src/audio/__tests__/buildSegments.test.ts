// ─────────────────────────────────────────────────────────────────────────────
// buildSegmentsForSource — Tier 1 Unit Tests
//
// Exercises the pure decode-segment builder with no browser API dependencies.
// Tests verify that the function correctly maps clip model → Segment list.
//
// Coverage:
//   • Single unmuted clip       — explicit clip segments
//   • Muted clips               — produces silence segments with correct duration
//   • Mixed muted/unmuted clips — correct interleaving
//   • Multi-source filtering    — only clips from the target sourceId included
//   • Solo/muted tracks         — track-level filtering respected
//   • startTime skip            — clips entirely before startTime are excluded
//   • Orphan-source suppression — no segments when no clip references a source
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { buildSegmentsForSource } from '../buildSegments'
import type { Track, Clip } from '@shared/project.types'
import type { FrameEntry } from '../FrameIndex'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal seek function: byteOffset = floor(time * 1000). */
function mockSeek(time: number): FrameEntry {
  return { byteOffset: Math.floor(time * 1000), time, duration: 0.023 }
}

function makeClip(
  id: string,
  sourceId: string,
  trackId: string,
  sourceStart: number,
  sourceEnd: number,
  muted = false,
): Clip {
  return {
    id,
    trackId,
    sourceFileId: sourceId,
    sourceStart,
    sourceEnd,
    outputStart: sourceStart, // simplest case: output = source
    gain: 1,
    muted,
    effects: [],
  }
}

function makeTrack(id: string, clips: Clip[], opts?: Partial<Track>): Track {
  return {
    id,
    name: id,
    clips,
    volume: 1,
    muted: false,
    solo: false,
    color: '#fff',
    effects: [],
    ...opts,
  }
}

const SOURCE_A = 'source-a'
const SOURCE_B = 'source-b'
const DURATION = 100
const FETCH = 32_768

// ══════════════════════════════════════════════════════════════════════════════
// No tracks — orphan-source suppression
// ══════════════════════════════════════════════════════════════════════════════

describe('orphan-source suppression', () => {
  it('returns no segments when no clip references the source', () => {
    const segs = buildSegmentsForSource(SOURCE_A, 0, [], mockSeek, DURATION, FETCH)
    expect(segs).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Single unmuted clip
// ══════════════════════════════════════════════════════════════════════════════

describe('single unmuted clip', () => {
  it('produces one real-audio segment spanning the clip', () => {
    const clips = [makeClip('c1', SOURCE_A, 'track1', 0, 100)]
    const tracks = [makeTrack('track1', clips)]
    const segs = buildSegmentsForSource(SOURCE_A, 0, tracks, mockSeek, DURATION, FETCH)
    expect(segs).toHaveLength(1)
    expect(segs[0].muted).toBe(false)
    expect(segs[0].durationSecs).toBeCloseTo(100)
  })

  it('skips the segment when startTime is past the clip end', () => {
    const clips = [makeClip('c1', SOURCE_A, 'track1', 0, 50)]
    const tracks = [makeTrack('track1', clips)]
    const segs = buildSegmentsForSource(SOURCE_A, 60, tracks, mockSeek, DURATION, FETCH)
    expect(segs).toHaveLength(1)
    expect(segs[0].muted).toBe(true)
    expect(segs[0].durationSecs).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Muted clips
// ══════════════════════════════════════════════════════════════════════════════

describe('muted clips', () => {
  it('produces a silence segment with the correct duration', () => {
    const clips = [makeClip('c1', SOURCE_A, 'track1', 20, 60, /* muted */ true)]
    const tracks = [makeTrack('track1', clips)]
    const segs = buildSegmentsForSource(SOURCE_A, 0, tracks, mockSeek, DURATION, FETCH)
    // The clip starts at outputStart=20, so the gap-fill inserts a 20s silence
    // segment from 0→20 before the clip's own 40s silence segment.
    expect(segs).toHaveLength(2)
    expect(segs[0].muted).toBe(true)
    expect(segs[0].durationSecs).toBeCloseTo(20) // gap: 0→20
    expect(segs[1].muted).toBe(true)
    expect(segs[1].durationSecs).toBeCloseTo(40) // muted clip: 20→60
    expect(segs[1].startByte).toBe(0)
    expect(segs[1].endByte).toBe(0)
  })

  it('clips duration when startTime falls inside a muted clip', () => {
    const clips = [makeClip('c1', SOURCE_A, 'track1', 20, 60, true)]
    const tracks = [makeTrack('track1', clips)]
    const segs = buildSegmentsForSource(SOURCE_A, 40, tracks, mockSeek, DURATION, FETCH)
    const mutedSeg = segs.find((s) => s.muted)!
    expect(mutedSeg.durationSecs).toBeCloseTo(20) // 60 - 40
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Mixed muted + unmuted clips
// ══════════════════════════════════════════════════════════════════════════════

describe('mixed clips', () => {
  it('produces the correct sequence: unmuted → muted → unmuted', () => {
    const clips = [
      makeClip('c1', SOURCE_A, 't1', 0, 30, false),
      makeClip('c2', SOURCE_A, 't1', 30, 60, true),
      makeClip('c3', SOURCE_A, 't1', 60, 100, false),
    ]
    const tracks = [makeTrack('t1', clips)]
    const segs = buildSegmentsForSource(SOURCE_A, 0, tracks, mockSeek, DURATION, FETCH)
    expect(segs).toHaveLength(3)
    expect(segs[0].muted).toBe(false)
    expect(segs[1].muted).toBe(true)
    expect(segs[2].muted).toBe(false)
  })

  it('skips clips that end before startTime', () => {
    const clips = [
      makeClip('c1', SOURCE_A, 't1', 0, 30, false),
      makeClip('c2', SOURCE_A, 't1', 30, 60, true),
      makeClip('c3', SOURCE_A, 't1', 60, 100, false),
    ]
    const tracks = [makeTrack('t1', clips)]
    // Start at 35 — c1 is entirely past, c2 should be included (partial), c3 included
    const segs = buildSegmentsForSource(SOURCE_A, 35, tracks, mockSeek, DURATION, FETCH)
    expect(segs).toHaveLength(2)
    expect(segs[0].muted).toBe(true)
    expect(segs[0].durationSecs).toBeCloseTo(25) // 60 - 35
    expect(segs[1].muted).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Multi-source filtering
// ══════════════════════════════════════════════════════════════════════════════

describe('multi-source filtering', () => {
  it('only includes clips whose sourceFileId matches sourceId', () => {
    const trackA = makeTrack('t1', [makeClip('ca', SOURCE_A, 't1', 0, 100, false)])
    const trackB = makeTrack('t2', [makeClip('cb', SOURCE_B, 't2', 0, 60, false)])
    const tracks = [trackA, trackB]

    const segsA = buildSegmentsForSource(SOURCE_A, 0, tracks, mockSeek, DURATION, FETCH)
    const segsB = buildSegmentsForSource(SOURCE_B, 0, tracks, mockSeek, 60, FETCH)

    expect(segsA.every((s) => !s.muted && s.durationSecs === DURATION)).toBe(true)
    // Source B clips produce one segment of duration 60
    const realSegs = segsB.filter((s) => !s.muted)
    expect(realSegs.reduce((acc, s) => acc + s.durationSecs, 0)).toBeCloseTo(60)
  })

  it('returns no segments if no clips match sourceId', () => {
    const trackB = makeTrack('t2', [makeClip('cb', SOURCE_B, 't2', 0, 60)])
    const segs = buildSegmentsForSource(SOURCE_A, 0, [trackB], mockSeek, DURATION, FETCH)
    expect(segs).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Track-level muted / solo filtering
// ══════════════════════════════════════════════════════════════════════════════

describe('track muted/solo', () => {
  it('excludes clips from muted tracks', () => {
    const clips = [makeClip('c1', SOURCE_A, 't1', 0, 100)]
    const tracks = [makeTrack('t1', clips, { muted: true })]
    const segs = buildSegmentsForSource(SOURCE_A, 0, tracks, mockSeek, DURATION, FETCH)
    // The source contributes silence because its only track is muted.
    expect(segs).toHaveLength(1)
    expect(segs[0].muted).toBe(true)
  })

  it('includes only solo tracks when any track is soloed', () => {
    const clipsA = [makeClip('ca', SOURCE_A, 'ta', 0, 100)]
    const clipsB = [makeClip('cb', SOURCE_A, 'tb', 0, 100)]
    const trackA = makeTrack('ta', clipsA, { solo: true })
    const trackB = makeTrack('tb', clipsB, { solo: false })
    const segs = buildSegmentsForSource(SOURCE_A, 0, [trackA, trackB], mockSeek, DURATION, FETCH)
    // Both clips are the same source, but trackB is excluded by solo mode
    expect(segs).toHaveLength(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// endByte includes fetchChunkSize
// ══════════════════════════════════════════════════════════════════════════════

describe('endByte includes fetchChunkSize', () => {
  it('adds fetchChunkSize to endByte so the last frame is fully captured', () => {
    const clips = [makeClip('c1', SOURCE_A, 't1', 0, 50)]
    const tracks = [makeTrack('t1', clips)]
    const segs = buildSegmentsForSource(SOURCE_A, 0, tracks, mockSeek, DURATION, FETCH)
    const realSeg = segs.find((s) => !s.muted)!
    const expectedEndByte = mockSeek(50).byteOffset + FETCH
    expect(realSeg.endByte).toBe(expectedEndByte)
  })
})
