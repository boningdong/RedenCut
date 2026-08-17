// ─────────────────────────────────────────────────────────────────────────────
// Timeline Store (Zustand)
//
// Owns the clip/track model — the authoritative edit state for the project.
// This replaces the flat edits[] array in editor.store with a proper
// multi-track, clip-based representation.
//
// Core concepts:
//   AudioSource — a stable managed source identity
//   Track       — a named lane that holds an ordered list of Clips
//   Clip        — a slice of an AudioSource placed at a position on the timeline
//
// Single-file workflow (the initial common case):
//   Import → initFromAudioSource() creates 1 AudioSource + 1 Track with 1 Clip
//   spanning [0, duration]. All editing operations split/mutate that initial
//   clip. The WebCodecs player reads this list to know what to play and skip.
//
// Undo model:
//   Each mutating operation saves a full snapshot of tracks[] before the
//   change. This is safe because tracks hold metadata only (no audio data).
//   wordIds are stored alongside each entry so undo can also reverse
//   transcript strikethroughs.
//
// Relationship to other stores:
//   editor.store   — project file path, isDirty, waveform selection, preview mode
//   playback.store — currentTime, duration, isPlaying (ephemeral, 60fps)
//   transcript.store — word list and mute state
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import type { AudioSourceId, Clip, Track } from '@shared/project.types'
import type { RendererAudioSource } from '@shared/session.types'
import { useEditorStore } from './editor.store'
import { useTranscriptStore } from './transcript.store'

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}-${++_idCounter}-${Date.now()}`
}

let _colorIndex = 0

/** Deep-clone tracks (metadata only — no audio buffers). */
function cloneTracks(tracks: Track[]): Track[] {
  return tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => ({ ...c, effects: [...c.effects] })),
    effects: [...t.effects],
  }))
}

function markTimelineEdited(): void {
  if (useEditorStore.getState().session) {
    useEditorStore.getState().markEdited()
  }
}

// ── History entry ──────────────────────────────────────────────────────────────

interface HistoryEntry {
  /** Snapshot of tracks[] BEFORE this operation — restored on undo. */
  before: Track[]
  /** Transcript word IDs that were muted by this operation (un-muted on undo). */
  wordIds: string[]
  /** Human-readable description for debugging. */
  label: string
}

// ── Store shape ────────────────────────────────────────────────────────────────

interface TimelineState {
  audioSources: RendererAudioSource[]
  tracks: Track[]
  undoStack: HistoryEntry[]
  /**
   * Populated by undo(); cleared by any new mutation.
   * Each entry holds a snapshot of tracks[] before the operation was undone,
   * along with the word IDs that were un-muted so redo can re-mute them.
   */
  redoStack: HistoryEntry[]

  // ── Initialisation ─────────────────────────────────────────────────────────

  /**
   * Bootstrap a single-file project: registers the source file and creates one
   * track with one clip spanning the full duration.
   * Called when the user opens a new audio file.
   */
  initFromAudioSource(audioSource: RendererAudioSource): void

  /**
   * Restore full state from a saved project.
   * Does NOT push to undo stack — loading is not an undoable action.
   */
  loadFromProject(audioSources: RendererAudioSource[], tracks: Track[]): void

  /** Register a managed source by stable identity. Not undoable. */
  addAudioSource(audioSource: RendererAudioSource): AudioSourceId

  // ── Track operations ───────────────────────────────────────────────────────

  addTrack(name?: string, audioSourceId?: AudioSourceId): string
  removeTrack(trackId: string): void
  updateTrack(trackId: string, patch: Partial<Omit<Track, 'id' | 'clips'>>): void

  // ── Clip operations ────────────────────────────────────────────────────────

  /**
   * Mute all clips within [startTime, endTime] on the given track.
   * Clips are split at the boundaries so the region can be independently
   * muted/unmuted.
   *
   * Routes by trackId because one source may be referenced by multiple tracks.
   *
   * @param wordIds  Transcript word IDs muted together with this operation.
   */
  muteRange(trackId: string, startTime: number, endTime: number, wordIds?: string[]): void

  /**
   * Remove a specific clip by ID from its track.
   * Clears selectedClipId if it matches the removed clip.
   */
  removeClip(clipId: string): void

  /**
   * Unmute a specific clip by ID, reversing its associated transcript words.
   * If the clip is adjacent to other unmuted clips it is merged back.
   */
  unmuteClip(clipId: string, wordIds?: string[]): void

  /**
   * Split the clip that contains `time` into two clips at that point.
   * Used by the S (split) keyboard shortcut.
   */
  splitAt(time: number): void

  /**
   * Move a clip to a new outputStart position, optionally changing its track.
   * Clips on the same track after the moved clip are reflowed.
   */
  moveClip(clipId: string, newOutputStart: number, newTrackId?: string): void

  // ── Selection ──────────────────────────────────────────────────────────────

  /** ID of the clip the user has clicked on the waveform. null = none. */
  selectedClipId: string | null
  setSelectedClipId(id: string | null): void

  /** ID of the currently selected track. Used by splitAt to target the right track. */
  selectedTrackId: string | null
  setSelectedTrackId(id: string | null): void

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  undo(): void
  redo(): void

  // ── Derived ────────────────────────────────────────────────────────────────

  /**
   * Returns all clips across all tracks, sorted by outputStart.
   * Useful for the audio player and export pipeline.
   */
  getAllClips(): Clip[]

  /** Returns the primary (first) track's clips, sorted by sourceStart. */
  getPrimaryClips(): Clip[]

  // ── Reset ──────────────────────────────────────────────────────────────────
  reset(): void
}

// ── Implementation ─────────────────────────────────────────────────────────────

const TRACK_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6']

const initialState = {
  audioSources: [] as RendererAudioSource[],
  tracks: [] as Track[],
  undoStack: [] as HistoryEntry[],
  redoStack: [] as HistoryEntry[],
  selectedClipId: null as string | null,
  selectedTrackId: null as string | null,
}

export const useTimelineStore = create<TimelineState>()((set, get) => ({
  ...initialState,

  // ── initFromAudioSource ─────────────────────────────────────────────────────
  initFromAudioSource(audioSource) {
    const audioSourceId = audioSource.id
    const duration = audioSource.metadata.durationSeconds
    const trackId = nextId('track')
    const clipId = nextId('clip')

    const clip: Clip = {
      id: clipId,
      trackId,
      audioSourceId,
      sourceStart: 0,
      sourceEnd: duration,
      outputStart: 0,
      gain: 1,
      muted: false,
      effects: [],
    }
    const track: Track = {
      id: trackId,
      name: 'Track 1',
      clips: [clip],
      volume: 1,
      muted: false,
      solo: false,
      color: TRACK_COLORS[_colorIndex++ % TRACK_COLORS.length],
      effects: [],
    }

    set({
      audioSources: [audioSource],
      tracks: [track],
      undoStack: [],
      redoStack: [],
      selectedTrackId: null,
      selectedClipId: null,
    })
  },

  // ── loadFromProject ─────────────────────────────────────────────────────────
  loadFromProject(audioSources, tracks) {
    set({
      audioSources,
      tracks,
      undoStack: [],
      redoStack: [],
      selectedTrackId: null,
      selectedClipId: null,
    })
  },

  // ── addAudioSource ─────────────────────────────────────────────────────────
  addAudioSource(audioSource) {
    const existing = get().audioSources.find((source) => source.id === audioSource.id)
    if (existing) {
      return existing.id
    }
    set((s) => ({ audioSources: [...s.audioSources, audioSource] }))
    return audioSource.id
  },

  // ── addTrack ────────────────────────────────────────────────────────────────
  addTrack(name, audioSourceId) {
    const trackId = nextId('track')
    const track: Track = {
      id: trackId,
      name: name ?? `Track ${get().tracks.length + 1}`,
      clips: [],
      volume: 1,
      muted: false,
      solo: false,
      color: TRACK_COLORS[_colorIndex++ % TRACK_COLORS.length],
      effects: [],
    }
    if (audioSourceId) {
      const source = get().audioSources.find((item) => item.id === audioSourceId)
      if (source) {
        track.clips.push({
          id: nextId('clip'),
          trackId,
          audioSourceId,
          sourceStart: 0,
          sourceEnd: source.metadata.durationSeconds,
          outputStart: 0,
          gain: 1,
          muted: false,
          effects: [],
        })
      }
    }
    set((s) => ({ tracks: [...s.tracks, track] }))
    markTimelineEdited()
    return trackId
  },

  // ── removeTrack ─────────────────────────────────────────────────────────────
  removeTrack(trackId) {
    if (!get().tracks.some((track) => track.id === trackId)) return
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== trackId) }))
    markTimelineEdited()
  },

  // ── updateTrack ─────────────────────────────────────────────────────────────
  updateTrack(trackId, patch) {
    if (!get().tracks.some((track) => track.id === trackId)) return
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    }))
    markTimelineEdited()
  },

  // ── muteRange ───────────────────────────────────────────────────────────────
  muteRange(trackId, startTime, endTime, wordIds = []) {
    const { tracks } = get()
    const track = tracks.find((t) => t.id === trackId)
    if (!track) {
      console.warn(`[Timeline] muteRange — no track found for trackId=${trackId}`)
      return
    }

    // Snapshot before mutation
    const before = cloneTracks(tracks)

    const newClips = splitAndMute(track.clips, startTime, endTime, track.id)
    if (
      newClips.length === track.clips.length &&
      newClips.every((clip, index) => clip === track.clips[index])
    ) {
      return
    }

    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, clips: newClips } : t)),
      undoStack: [
        ...s.undoStack,
        { before, wordIds, label: `mute [${startTime.toFixed(1)}–${endTime.toFixed(1)}]` },
      ],
      redoStack: [], // any new mutation invalidates the redo future
    }))
    markTimelineEdited()

    if (wordIds.length > 0) {
      useTranscriptStore.getState().muteWords(wordIds)
    }
  },

  // ── removeClip ──────────────────────────────────────────────────────────────
  removeClip(clipId) {
    const { tracks } = get()
    const track = tracks.find((t) => t.clips.some((c) => c.id === clipId))
    if (!track) {
      console.warn(`[Timeline] removeClip — clip ${clipId} not found`)
      return
    }

    const before = cloneTracks(tracks)

    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
      ),
      undoStack: [...s.undoStack, { before, wordIds: [], label: `remove clip ${clipId}` }],
      redoStack: [],
      selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
    }))
    markTimelineEdited()
  },

  // ── unmuteClip ──────────────────────────────────────────────────────────────
  unmuteClip(clipId, wordIds = []) {
    const { tracks } = get()
    const track = tracks.find((t) => t.clips.some((c) => c.id === clipId))
    if (!track) return

    const before = cloneTracks(tracks)

    // Set clip unmuted, then merge adjacent unmuted clips
    const updated = track.clips.map((c) => (c.id === clipId ? { ...c, muted: false } : c))
    const merged = mergeAdjacentUnmuted(updated)

    // Find wordIds from undo stack if not provided
    const resolvedWordIds =
      wordIds.length > 0 ? wordIds : findWordIdsForClip(get().undoStack, clipId)

    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, clips: merged } : t)),
      undoStack: [
        ...s.undoStack,
        { before, wordIds: resolvedWordIds, label: `unmute clip ${clipId}` },
      ],
      redoStack: [], // new mutation invalidates the redo future
      selectedClipId: null,
    }))
    markTimelineEdited()

    if (resolvedWordIds.length > 0) {
      useTranscriptStore.getState().unmuteWords(resolvedWordIds)
    }
  },

  // ── splitAt ─────────────────────────────────────────────────────────────────
  splitAt(time) {
    const { tracks, selectedClipId } = get()

    if (!selectedClipId) return

    let targetTrackId: string | null = null
    let targetClip: Clip | null = null

    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId)
      if (clip) {
        targetTrackId = track.id
        targetClip = clip
        break
      }
    }

    if (!targetTrackId || !targetClip) return

    // Only split if the playhead is inside the selected clip's output range
    const clipOutputEnd = targetClip.outputStart + (targetClip.sourceEnd - targetClip.sourceStart)
    if (time <= targetClip.outputStart || time >= clipOutputEnd) return

    const before = cloneTracks(tracks)
    const offset = time - targetClip.outputStart
    const left: Clip = {
      ...targetClip,
      id: nextId('clip'),
      sourceEnd: targetClip.sourceStart + offset,
      // outputStart unchanged — left clip starts where it always started
    }
    const right: Clip = {
      ...targetClip,
      id: nextId('clip'),
      sourceStart: targetClip.sourceStart + offset,
      outputStart: time,
    }

    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === targetTrackId
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === targetClip!.id ? [left, right] : [c])) }
          : t,
      ),
      undoStack: [...s.undoStack, { before, wordIds: [], label: `split at ${time.toFixed(1)}` }],
      redoStack: [], // new mutation invalidates the redo future
    }))
    markTimelineEdited()
  },

  // ── moveClip ────────────────────────────────────────────────────────────────
  moveClip(clipId, newOutputStart, newTrackId) {
    const { tracks } = get()
    const srcTrack = tracks.find((t) => t.clips.some((c) => c.id === clipId))
    if (!srcTrack) return

    const before = cloneTracks(tracks)
    const clip = srcTrack.clips.find((c) => c.id === clipId)!
    const destId = newTrackId ?? srcTrack.id
    const clipDur = clip.sourceEnd - clip.sourceStart

    set((s) => {
      let newTracks = s.tracks

      // Remove clip from source track
      newTracks = newTracks.map((t) =>
        t.id === srcTrack.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
      )

      // Insert into dest track at the nearest valid (non-overlapping) position.
      // Uses slot enumeration rather than iterative pushing to avoid oscillation
      // when the drop zone gap is too small for the clip.
      // Cross-track overlap is allowed (clips on different tracks mix in audio).
      const movedClip: Clip = { ...clip, trackId: destId, outputStart: newOutputStart }
      newTracks = newTracks.map((t) => {
        if (t.id !== destId) return t
        const others = t.clips // source clip was already removed above

        // Sort others by outputStart to enumerate valid placement slots
        const sorted = [...others].sort((a, b) => a.outputStart - b.outputStart)
        let bestStart = Math.max(0, newOutputStart)
        let bestDist = Infinity

        const tryCandidate = (pos: number) => {
          const dist = Math.abs(pos - newOutputStart)
          if (dist < bestDist) {
            bestDist = dist
            bestStart = pos
          }
        }

        if (sorted.length === 0) {
          bestStart = Math.max(0, newOutputStart)
        } else {
          // Slot before first clip: [0, first.outputStart - clipDur]
          const firstStart = sorted[0].outputStart
          if (firstStart >= clipDur) {
            tryCandidate(Math.min(Math.max(0, newOutputStart), firstStart - clipDur))
          }
          // Slots between consecutive clips
          for (let i = 0; i < sorted.length - 1; i++) {
            const slotFrom = sorted[i].outputStart + (sorted[i].sourceEnd - sorted[i].sourceStart)
            const slotTo = sorted[i + 1].outputStart - clipDur
            if (slotFrom <= slotTo) {
              tryCandidate(Math.min(Math.max(slotFrom, newOutputStart), slotTo))
            }
          }
          // Slot after last clip: [lastEnd, ∞)
          const lastEnd =
            sorted[sorted.length - 1].outputStart +
            (sorted[sorted.length - 1].sourceEnd - sorted[sorted.length - 1].sourceStart)
          tryCandidate(Math.max(lastEnd, newOutputStart))
        }

        const resolved = { ...movedClip, outputStart: bestStart }
        const inserted = [...others, resolved].sort((a, b) => a.outputStart - b.outputStart)
        return { ...t, clips: inserted }
      })

      return {
        tracks: newTracks,
        undoStack: [...s.undoStack, { before, wordIds: [], label: `move clip ${clipId}` }],
        redoStack: [], // new mutation invalidates the redo future
      }
    })
    markTimelineEdited()
  },

  // ── selectedClipId ──────────────────────────────────────────────────────────
  setSelectedClipId(id) {
    set({ selectedClipId: id })
  },

  // ── selectedTrackId ─────────────────────────────────────────────────────────
  setSelectedTrackId(id) {
    set({ selectedTrackId: id })
  },

  // ── undo ────────────────────────────────────────────────────────────────────
  undo() {
    const { undoStack, tracks } = get()
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]

    // Capture current state as a redo entry so we can re-apply this op.
    // The redo entry's `before` is the state we are about to revert FROM (i.e. current tracks),
    // and its `wordIds` are re-muted on redo.
    const redoEntry: HistoryEntry = {
      before: cloneTracks(tracks),
      wordIds: entry.wordIds,
      label: entry.label,
    }

    set((s) => ({
      tracks: entry.before,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, redoEntry],
      selectedClipId: null,
    }))
    markTimelineEdited()
    if (entry.wordIds.length > 0) {
      useTranscriptStore.getState().unmuteWords(entry.wordIds)
    }
  },

  // ── redo ────────────────────────────────────────────────────────────────────
  redo() {
    const { redoStack, tracks } = get()
    if (redoStack.length === 0) return
    const entry = redoStack[redoStack.length - 1]

    // Capture current (pre-redo) state as an undo entry so the user can undo again.
    const undoEntry: HistoryEntry = {
      before: cloneTracks(tracks),
      wordIds: entry.wordIds,
      label: entry.label,
    }

    set((s) => ({
      tracks: entry.before,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, undoEntry],
      selectedClipId: null,
    }))
    markTimelineEdited()
    if (entry.wordIds.length > 0) {
      useTranscriptStore.getState().muteWords(entry.wordIds)
    }
  },

  // ── getAllClips / getPrimaryClips ────────────────────────────────────────────
  getAllClips() {
    return get()
      .tracks.flatMap((t) => t.clips)
      .sort((a, b) => a.outputStart - b.outputStart)
  },

  getPrimaryClips() {
    const { tracks } = get()
    if (tracks.length === 0) return []
    return [...tracks[0].clips].sort((a, b) => a.sourceStart - b.sourceStart)
  },

  // ── reset ────────────────────────────────────────────────────────────────────
  reset() {
    set({ ...initialState })
  },
}))

// ── Clip surgery helpers ───────────────────────────────────────────────────────

/**
 * Split clips in a track so that [startTime, endTime] forms its own clip
 * segment, then mark all clips within that range as muted.
 */
function splitAndMute(clips: Clip[], startTime: number, endTime: number, trackId: string): Clip[] {
  const result: Clip[] = []

  for (const clip of clips) {
    const clipOutputEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
    // Clip entirely outside the mute range — keep as-is
    if (clipOutputEnd <= startTime || clip.outputStart >= endTime) {
      result.push(clip)
      continue
    }

    const muteOutputStart = Math.max(clip.outputStart, startTime)
    const muteOutputEnd = Math.min(clipOutputEnd, endTime)
    const effectiveMuteStart = clip.sourceStart + (muteOutputStart - clip.outputStart)
    const effectiveMuteEnd = clip.sourceStart + (muteOutputEnd - clip.outputStart)

    // Left remainder (before the mute region)
    if (clip.sourceStart < effectiveMuteStart) {
      result.push({
        ...clip,
        id: nextId('clip'),
        sourceEnd: effectiveMuteStart,
        outputStart: clip.outputStart,
      })
    }

    // The muted segment inherits audioSourceId from the source clip.
    result.push({
      ...clip,
      id: nextId('clip'),
      trackId,
      sourceStart: effectiveMuteStart,
      sourceEnd: effectiveMuteEnd,
      outputStart: muteOutputStart,
      muted: true,
    })

    // Right remainder (after the mute region)
    if (clip.sourceEnd > effectiveMuteEnd) {
      result.push({
        ...clip,
        id: nextId('clip'),
        sourceStart: effectiveMuteEnd,
        outputStart: muteOutputEnd,
      })
    }
  }

  return result
}

/**
 * Merge adjacent unmuted clips of the same source file into one.
 * Applied after an unmute operation to keep the clip list tidy.
 *
 * A pair of clips is mergeable only when they are adjacent in BOTH source
 * space (sourceEnd ≈ sourceStart) AND output space (outputEnd ≈ outputStart).
 * Clips that have been repositioned (outputStart ≠ sourceStart) are NOT merged
 * even if their source ranges are contiguous.
 */
function mergeAdjacentUnmuted(clips: Clip[]): Clip[] {
  if (clips.length === 0) return clips
  // Sort by output position — the order clips appear on the timeline
  const sorted = [...clips].sort((a, b) => a.outputStart - b.outputStart)
  const merged: Clip[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]
    const prevOutputEnd = prev.outputStart + (prev.sourceEnd - prev.sourceStart)
    if (
      !prev.muted &&
      !curr.muted &&
      prev.audioSourceId === curr.audioSourceId &&
      prev.trackId === curr.trackId &&
      Math.abs(prev.sourceEnd - curr.sourceStart) < 0.001 && // source adjacent
      Math.abs(prevOutputEnd - curr.outputStart) < 0.001 // output adjacent
    ) {
      // Merge: extend prev's source range; output position unchanged
      merged[merged.length - 1] = { ...prev, sourceEnd: curr.sourceEnd }
    } else {
      merged.push(curr)
    }
  }
  return merged
}

/** Search the undo stack for wordIds associated with a specific clip. */
function findWordIdsForClip(undoStack: HistoryEntry[], clipId: string): string[] {
  // Walk from newest to oldest — return wordIds from the most recent entry
  // that appears to have created this clip (heuristic: check if the clip
  // existed after this entry's before-snapshot).
  for (let i = undoStack.length - 1; i >= 0; i--) {
    const entry = undoStack[i]
    const wasAbsent = !entry.before.some((t) => t.clips.some((c) => c.id === clipId))
    if (wasAbsent && entry.wordIds.length > 0) return entry.wordIds
  }
  return []
}
