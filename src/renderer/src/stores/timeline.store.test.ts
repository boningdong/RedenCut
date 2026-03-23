import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelineStore } from './timeline.store'

beforeEach(() => {
  useTimelineStore.getState().reset()
})

// ── addSourceFile ────────────────────────────────────────────────────────

describe('addSourceFile', () => {
  it('creates a new SourceFile and returns its id', () => {
    const id = useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
    expect(id).toBe('/tmp/a.mp3')
    const { sourceFiles } = useTimelineStore.getState()
    expect(sourceFiles).toHaveLength(1)
    expect(sourceFiles[0]).toMatchObject({ id: '/tmp/a.mp3', filePath: '/tmp/a.mp3', duration: 10 })
  })

  it('is idempotent — calling twice with the same path does not duplicate', () => {
    useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
    const id2 = useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
    expect(id2).toBe('/tmp/a.mp3')
    expect(useTimelineStore.getState().sourceFiles).toHaveLength(1)
  })

  it('does not push to undoStack', () => {
    useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  })
})

// ── splitAt — output coordinate correctness ──────────────────────────────

describe('splitAt — after moveClip', () => {
  it('finds clip using output coordinates, not source coordinates', () => {
    // Set up a single clip at outputStart=10, sourceStart=0, sourceEnd=5
    useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
    const { tracks } = useTimelineStore.getState()
    const track = tracks[0]
    const clip = track.clips[0]
    // Manually move the clip to outputStart=10 by calling moveClip
    useTimelineStore.getState().moveClip(clip.id, 10)
    // Select the clip before splitting
    useTimelineStore.getState().setSelectedClipId(clip.id)

    // Now splitAt time=12 (inside the clip at output coords 10–20)
    useTimelineStore.getState().splitAt(12)

    const { tracks: newTracks } = useTimelineStore.getState()
    const clips = newTracks[0].clips
    expect(clips).toHaveLength(2)
  })

  it('left clip sourceEnd is mapped back to source coordinates', () => {
    useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
    const { tracks } = useTimelineStore.getState()
    const clip = tracks[0].clips[0]
    useTimelineStore.getState().moveClip(clip.id, 10)
    useTimelineStore.getState().setSelectedClipId(clip.id)

    // splitAt output time=12 → offset from outputStart=10 is 2s
    // left.sourceEnd should be sourceStart(0) + 2 = 2
    useTimelineStore.getState().splitAt(12)

    const leftClip = useTimelineStore.getState().tracks[0].clips[0]
    expect(leftClip.sourceEnd).toBeCloseTo(2)
    expect(leftClip.outputStart).toBeCloseTo(10)
  })

  it('right clip sourceStart and outputStart are updated correctly', () => {
    useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
    const { tracks } = useTimelineStore.getState()
    const clip = tracks[0].clips[0]
    useTimelineStore.getState().moveClip(clip.id, 10)
    useTimelineStore.getState().setSelectedClipId(clip.id)

    useTimelineStore.getState().splitAt(12)

    const clips = useTimelineStore.getState().tracks[0].clips
    const rightClip = clips[1]
    expect(rightClip.sourceStart).toBeCloseTo(2)   // sourceStart + offset
    expect(rightClip.outputStart).toBeCloseTo(12)  // = time
  })

  it('is a no-op when time is at exactly the clip boundary (not strictly inside)', () => {
    useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
    const { tracks } = useTimelineStore.getState()
    const clip = tracks[0].clips[0]
    useTimelineStore.getState().moveClip(clip.id, 10)
    useTimelineStore.getState().setSelectedClipId(clip.id)
    const stackBefore = useTimelineStore.getState().undoStack.length

    // time === outputStart (not strictly inside clip)
    useTimelineStore.getState().splitAt(10)
    expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(1)
    expect(useTimelineStore.getState().undoStack.length).toBe(stackBefore)
  })
})

// ── addSourceFile — edge cases ───────────────────────────────────────────────

describe('addSourceFile — same path, different duration', () => {
  it('does not update duration when file already registered (returns existing id)', () => {
    useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
    useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 99)
    const sf = useTimelineStore.getState().sourceFiles[0]
    expect(sf.duration).toBe(10)  // original duration preserved
  })
})
