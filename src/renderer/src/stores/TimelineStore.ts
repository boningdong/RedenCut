import {
  DEFAULT_CROSSFADE_SETTINGS,
  CrossfadeSettingsSchema,
  type CrossfadeSettings,
} from '@shared/audio/CrossfadeTypes'
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
//   clip. The managed PCM player reads this list to build its playback plan.
//
// Undo model:
//   Each mutating operation saves a full snapshot of tracks[] before the
//   change. This is safe because tracks hold metadata only (no audio data).
//   Transcript coverage is derived from these same clip snapshots.
//
// Relationship to other stores:
//   editor.store   — path-free session, isDirty, waveform selection, preview mode
//   playback.store — currentTime, duration, isPlaying (ephemeral, 60fps)
//   transcript.store — word list and mute state
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import { useEditorHistoryStore, type DomainHistoryEdit } from './EditorHistoryStore'
import type { AudioSourceId, Clip, ClipRedaction, Track } from '@shared/ProjectTypes'
import type { RendererAudioSource } from '@shared/session.types'
import { useEditorStore } from './editor.store'
import { redactionCoverage } from '@shared/ClipRedactions'
import {
  changeMixLink,
  changeMixSources,
  isLinkedClip,
  linkedMasterForTrack,
  synchronizeMixEdits,
  sliceLinkedClip,
} from '../domain/MixLinkEdits'
import { planClipPlacement } from '../domain/TimelinePlacement'

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}-${++_idCounter}-${Date.now()}`
}

/** Deep-clone tracks (metadata only — no audio buffers). */
function cloneTracks(tracks: Track[]): Track[] {
  return tracks.map((t) => ({
    ...t,
    mixLink: t.mixLink
      ? {
          stemTrackIds: [...t.mixLink.stemTrackIds],
          hiddenSegments: t.mixLink.hiddenSegments?.map((segment) => ({
            ...segment,
            clip: sliceLinkedClip(
              segment.clip,
              segment.clip.outputStart,
              segment.clip.outputStart + segment.clip.sourceEnd - segment.clip.sourceStart,
            ),
          })),
        }
      : undefined,
    clips: t.clips.map((c) => ({
      ...c,
      sourceOverrides: c.sourceOverrides?.map((override) => ({
        ...override,
        stemTrackIds: [...override.stemTrackIds],
      })),
      effects: [...c.effects],
      redactions: c.redactions?.map((r) => ({
        ...r,
        crossfade: r.crossfade ? { ...r.crossfade } : undefined,
      })),
    })),
    effects: [...t.effects],
  }))
}

function markTimelineEdited(): void {
  if (useEditorStore.getState().session) {
    useEditorStore.getState().markEdited()
  }
}

function normalizedSelection(tracks: Track[], ids: string[], primaryId?: string) {
  const available = new Set(tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
  const selectedClipIds = [...new Set(ids)].filter((id) => available.has(id))
  const selectedClipId =
    primaryId && selectedClipIds.includes(primaryId) ? primaryId : (selectedClipIds[0] ?? null)
  return {
    selectedClipIds,
    selectedClipId,
    timelineSelection: selectedClipId ? ({ kind: 'clip', clipId: selectedClipId } as const) : null,
  }
}

function tracksEqual(left: Track[], right: Track[]): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

// ── History entry ──────────────────────────────────────────────────────────────

interface HistoryEntry {
  domainEdit?: DomainHistoryEdit
  /** Snapshot of tracks[] BEFORE this operation — restored on undo. */
  before: Track[]
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
   */
  redoStack: HistoryEntry[]
  /** Changes whenever the active project timeline is replaced. */
  projectGeneration: number

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

  /** Refresh authoritative source descriptors without discarding visible edit history. */
  refreshAudioSources(audioSources: RendererAudioSource[]): void

  /** Add imported tracks to the baseline of live state and existing edit history. */
  appendImportedTracks(tracks: Track[]): void

  /** Register a managed source by stable identity. Not undoable. */
  addAudioSource(audioSource: RendererAudioSource): AudioSourceId

  // ── Track operations ───────────────────────────────────────────────────────

  setMixLink(mixTrackId: string, stemTrackIds: string[]): boolean
  replaceMixSources(
    mixTrackId: string,
    start: number,
    end: number,
    stemTrackIds: string[],
    previousRange?: { start: number; end: number },
  ): boolean
  restoreMixSources(mixTrackId: string, start: number, end: number): boolean

  addTrack(name?: string, audioSourceId?: AudioSourceId): string
  removeTrack(trackId: string): void
  updateTrack(trackId: string, patch: Partial<Omit<Track, 'id' | 'clips'>>): void

  // ── Clip operations ────────────────────────────────────────────────────────

  /**
   * Add clip-owned redactions within an output-time range on one track.
   *
   * Routes by trackId because one source may be referenced by multiple tracks.
   *
   */
  redactRange(trackId: string, startTime: number, endTime: number): void
  /** Redact source-time ranges in one exact clip occurrence as a single undoable edit. */
  redactClipRanges(
    trackId: string,
    clipId: string,
    ranges: Array<{ start: number; end: number }>,
  ): void

  /** Apply one continuous source selection to an exact, unchanged clip chain. */
  redactTranscriptRange(
    trackId: string,
    expectedClips: Clip[],
    range: { start: number; end: number },
  ): boolean

  /**
   * Remove a specific clip by ID from its track.
   * Clears selectedClipId if it matches the removed clip.
   */
  removeClip(clipId: string): void
  removeClips(ids: string[]): void

  /**
   * Restore ordinary clip audibility without changing its overlays or boundaries.
   */
  unmuteClip(clipId: string): void

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
  commitTracks(
    expected: Track[],
    next: Track[],
    label: string,
    selectedIds?: string[],
    synchronized?: boolean,
  ): boolean

  // ── Selection ──────────────────────────────────────────────────────────────

  /** ID of the clip the user has clicked on the waveform. null = none. */
  selectedClipId: string | null
  selectedClipIds: string[]
  timelineSelection:
    | { kind: 'clip'; clipId: string }
    | { kind: 'redaction'; clipId: string; redactionId: string; editingCrossfade?: boolean }
    | null
  selectRedaction(clipId: string, redactionId: string): void
  setCrossfadeEditing(clipId: string, redactionId: string, editing: boolean): void
  updateRedactionCrossfade(clipId: string, redactionId: string, settings: CrossfadeSettings): void
  updateRedaction(
    clipId: string,
    redactionId: string,
    range: Pick<ClipRedaction, 'sourceStart' | 'sourceEnd'>,
    mode?: 'resize' | 'move',
  ): void
  removeRedaction(clipId: string, redactionId: string): void
  setClipMuted(clipId: string, muted: boolean): void
  setClipsMuted(ids: string[], muted: boolean): void
  setSelectedClipId(id: string | null): void
  setSelectedClipIds(ids: string[], primaryId?: string): void

  snappingEnabled: boolean
  setSnappingEnabled(enabled: boolean): void
  insertMode: boolean
  setInsertMode(enabled: boolean): void

  /** ID of the currently selected track. Used by splitAt to target the right track. */
  selectedTrackId: string | null
  setSelectedTrackId(id: string | null): void

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  recordDomainEdit(edit: DomainHistoryEdit): void
  undo(): void | Promise<void>
  redo(): void | Promise<void>

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

import { nextTrackColor } from '@shared/trackColors'

const initialState = {
  audioSources: [] as RendererAudioSource[],
  tracks: [] as Track[],
  undoStack: [] as HistoryEntry[],
  redoStack: [] as HistoryEntry[],
  projectGeneration: 0,
  selectedClipId: null as string | null,
  selectedClipIds: [] as string[],
  timelineSelection: null as TimelineState['timelineSelection'],
  selectedTrackId: null as string | null,
  snappingEnabled: true,
  insertMode: false,
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
      color: nextTrackColor(get().tracks.map((track) => track.color)),
      effects: [],
    }

    set({
      audioSources: [audioSource],
      tracks: [track],
      undoStack: [],
      redoStack: [],
      projectGeneration: get().projectGeneration + 1,
      selectedTrackId: null,
      selectedClipId: null,
      selectedClipIds: [],
      timelineSelection: null,
      snappingEnabled: true,
      insertMode: false,
    })
  },

  // ── loadFromProject ─────────────────────────────────────────────────────────
  loadFromProject(audioSources, tracks) {
    set({
      audioSources,
      tracks,
      undoStack: [],
      redoStack: [],
      projectGeneration: get().projectGeneration + 1,
      selectedTrackId: null,
      selectedClipId: null,
      selectedClipIds: [],
      timelineSelection: null,
      snappingEnabled: true,
      insertMode: false,
    })
  },

  refreshAudioSources(audioSources) {
    set({ audioSources })
  },

  appendImportedTracks(importedTracks) {
    if (importedTracks.length === 0) return
    set((state) => {
      const appendMissing = (tracks: Track[]) => {
        const ids = new Set(tracks.map((track) => track.id))
        const additions = importedTracks.filter((track) => !ids.has(track.id))
        return additions.length ? [...tracks, ...cloneTracks(additions)] : tracks
      }
      // Import establishes a non-undoable baseline; older clip edits must retain that baseline.
      const rebase = (entry: HistoryEntry): HistoryEntry => ({
        ...entry,
        before: appendMissing(entry.before),
      })
      return {
        tracks: appendMissing(state.tracks),
        undoStack: state.undoStack.map(rebase),
        redoStack: state.redoStack.map(rebase),
      }
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
      color: nextTrackColor(get().tracks.map((track) => track.color)),
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

  setMixLink(mixTrackId, stemTrackIds) {
    const tracks = get().tracks
    const next = changeMixLink(tracks, mixTrackId, stemTrackIds)
    return next ? get().commitTracks(tracks, next, 'Change Mix sources') : false
  },
  replaceMixSources(mixTrackId, start, end, stemTrackIds, previousRange) {
    const tracks = get().tracks
    const restored = previousRange
      ? changeMixSources(tracks, mixTrackId, previousRange.start, previousRange.end)
      : tracks
    const next = restored ? changeMixSources(restored, mixTrackId, start, end, stemTrackIds) : null
    return next ? get().commitTracks(tracks, next, 'Replace Mix audio') : false
  },
  restoreMixSources(mixTrackId, start, end) {
    const tracks = get().tracks
    const next = changeMixSources(tracks, mixTrackId, start, end)
    return next ? get().commitTracks(tracks, next, 'Restore Mix audio') : false
  },
  removeTrack(trackId) {
    const tracks = get().tracks
    const removed = tracks.find((track) => track.id === trackId)
    if (!removed) return
    let next = tracks
    const master = linkedMasterForTrack(tracks, trackId)
    if (master)
      next = changeMixLink(
        next,
        master.id,
        master.mixLink!.stemTrackIds.filter((id) => id !== trackId),
      )!
    if (removed.mixLink) next = changeMixLink(next, trackId, [])!
    next = next.filter((track) => track.id !== trackId)
    get().commitTracks(tracks, next, 'Remove track')
    if (get().selectedTrackId === trackId) set({ selectedTrackId: null })
  },

  // ── updateTrack ─────────────────────────────────────────────────────────────
  updateTrack(trackId, patch) {
    if (linkedMasterForTrack(get().tracks, trackId)) return
    if (patch.mixLink !== undefined) return
    if (!get().tracks.some((track) => track.id === trackId)) return
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    }))
    markTimelineEdited()
  },

  // ── redactRange ───────────────────────────────────────────────────────────────
  redactRange(trackId, startTime, endTime) {
    if (linkedMasterForTrack(get().tracks, trackId)) return
    const { tracks } = get()
    const track = tracks.find((t) => t.id === trackId)
    if (!track) {
      console.warn(`[Timeline] redactRange — no track found for trackId=${trackId}`)
      return
    }

    // Snapshot before mutation
    const before = cloneTracks(tracks)

    const newClips = addRedactions(track.clips, startTime, endTime, track.id)
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
        { before, label: `Redact [${startTime.toFixed(1)}–${endTime.toFixed(1)}]` },
      ],
      redoStack: [], // any new mutation invalidates the redo future
    }))
    markTimelineEdited()
  },

  redactClipRanges(trackId, clipId, ranges) {
    if (linkedMasterForTrack(get().tracks, trackId)) return
    const { tracks } = get()
    const track = tracks.find((item) => item.id === trackId)
    const clip = track?.clips.find((item) => item.id === clipId)
    if (!track || !clip || ranges.length === 0) return
    if (
      ranges.some(
        (range) =>
          !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start,
      )
    )
      return
    const bounded = ranges
      .map((range) => ({
        start: Math.max(clip.sourceStart, range.start),
        end: Math.min(clip.sourceEnd, range.end),
      }))
      .filter((range) => range.end > range.start)
      .sort((left, right) => left.start - right.start)
    const merged: Array<{ start: number; end: number }> = []
    for (const range of bounded) {
      const last = merged[merged.length - 1]
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
      else merged.push({ ...range })
    }
    if (!merged.length) return
    let replacement = [clip]
    for (const range of merged) {
      replacement = addRedactions(
        replacement,
        clip.outputStart + range.start - clip.sourceStart,
        clip.outputStart + range.end - clip.sourceStart,
        trackId,
      )
    }
    if (replacement[0] === clip) return
    const before = cloneTracks(tracks)
    set((state) => ({
      tracks: state.tracks.map((item) =>
        item.id === trackId
          ? {
              ...item,
              clips: item.clips.flatMap((candidate) =>
                candidate.id === clipId ? replacement : [candidate],
              ),
            }
          : item,
      ),
      undoStack: [...state.undoStack, { before, label: 'Redact transcript selection' }],
      redoStack: [],
    }))
    markTimelineEdited()
  },

  redactTranscriptRange(trackId, expectedClips, range) {
    if (linkedMasterForTrack(get().tracks, trackId)) return false
    const { tracks } = get()
    const track = tracks.find((t) => t.id === trackId)
    const clips = [...expectedClips].sort((a, b) => a.outputStart - b.outputStart)
    if (
      !track ||
      !clips.length ||
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.end <= range.start
    )
      return false
    if (
      new Set(clips.map((c) => c.id)).size !== clips.length ||
      clips.some((c, i) => {
        const current = track.clips.find((x) => x.id === c.id)
        return (
          !current ||
          JSON.stringify(current) !== JSON.stringify(c) ||
          c.audioSourceId !== clips[0].audioSourceId ||
          (i > 0 &&
            (Math.abs(clips[i - 1].sourceEnd - c.sourceStart) > 1e-7 ||
              Math.abs(
                clips[i - 1].outputStart +
                  clips[i - 1].sourceEnd -
                  clips[i - 1].sourceStart -
                  c.outputStart,
              ) > 1e-7))
        )
      })
    )
      return false
    if (range.start < clips[0].sourceStart || range.end > clips[clips.length - 1].sourceEnd)
      return false
    const targeted = new Set(clips.map((c) => c.id))
    const start = clips[0].outputStart + range.start - clips[0].sourceStart
    const end = clips[0].outputStart + range.end - clips[0].sourceStart
    // Never include a second overlapping occurrence merely because its source time matches.
    if (
      clips.length > 1 &&
      track.clips.some(
        (c) =>
          !targeted.has(c.id) &&
          c.outputStart < end &&
          c.outputStart + c.sourceEnd - c.sourceStart > start,
      )
    )
      return false
    if (!clips.some((c) => c.sourceStart < range.end && c.sourceEnd > range.start)) return true
    const pieces = addRedactions(clips, start, end, trackId)
    if (pieces.every((clip, index) => clip === clips[index])) return true
    const before = cloneTracks(tracks)
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: t.clips.flatMap((c) =>
                c.id === clips[0].id ? pieces : targeted.has(c.id) ? [] : [c],
              ),
            }
          : t,
      ),
      undoStack: [...state.undoStack, { before, label: 'Redact transcript selection' }],
      redoStack: [],
    }))
    markTimelineEdited()
    return true
  },

  // ── removeClip ──────────────────────────────────────────────────────────────
  removeClip(clipId) {
    get().removeClips([clipId])
  },

  removeClips(ids) {
    const { tracks, selectedClipIds } = get()
    const removed = new Set(ids.filter((id) => !isLinkedClip(tracks, id)))
    if (!tracks.some((track) => track.clips.some((clip) => removed.has(clip.id)))) return
    const next = tracks.map((track) => {
      const clips = track.clips.filter((clip) => !removed.has(clip.id))
      return clips.length === track.clips.length ? track : { ...track, clips }
    })
    get().commitTracks(
      tracks,
      next,
      ids.length === 1 ? `remove clip ${ids[0]}` : 'Remove clips',
      selectedClipIds.filter((id) => !removed.has(id)),
    )
  },

  // ── unmuteClip ──────────────────────────────────────────────────────────────
  unmuteClip(clipId) {
    get().setClipMuted(clipId, false)
  },

  // ── splitAt ─────────────────────────────────────────────────────────────────
  splitAt(time) {
    const { tracks, selectedClipId } = get()

    if (!selectedClipId || isLinkedClip(tracks, selectedClipId)) return

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

    const offset = time - targetClip.outputStart
    const left: Clip = {
      ...targetClip,
      id: nextId('clip'),
      sourceEnd: targetClip.sourceStart + offset,
      redactions: (targetClip.redactions ?? [])
        .filter((r) => r.sourceStart < targetClip.sourceStart + offset)
        .map((r) => ({
          ...r,
          crossfade: r.crossfade ? { ...r.crossfade } : undefined,
          id: nextId('redaction'),
          sourceEnd: Math.min(r.sourceEnd, targetClip.sourceStart + offset),
        })),
      // outputStart unchanged — left clip starts where it always started
    }
    const right: Clip = {
      ...targetClip,
      id: nextId('clip'),
      sourceStart: targetClip.sourceStart + offset,
      outputStart: time,
      redactions: (targetClip.redactions ?? [])
        .filter((r) => r.sourceEnd > targetClip.sourceStart + offset)
        .map((r) => ({
          ...r,
          crossfade: r.crossfade ? { ...r.crossfade } : undefined,
          id: nextId('redaction'),
          sourceStart: Math.max(r.sourceStart, targetClip.sourceStart + offset),
        })),
    }

    for (const piece of [left, right]) {
      piece.sourceOverrides = targetClip.sourceOverrides
        ?.filter((override) =>
          piece === left
            ? override.sourceStart < right.sourceStart
            : override.sourceEnd > right.sourceStart,
        )
        .map((override) => ({
          ...override,
          id: nextId('override'),
          sourceStart:
            piece === right
              ? Math.max(override.sourceStart, right.sourceStart)
              : override.sourceStart,
          sourceEnd:
            piece === left ? Math.min(override.sourceEnd, right.sourceStart) : override.sourceEnd,
          stemTrackIds: [...override.stemTrackIds],
        }))
    }
    const next = tracks.map((t) =>
      t.id === targetTrackId
        ? { ...t, clips: t.clips.flatMap((c) => (c.id === targetClip!.id ? [left, right] : [c])) }
        : t,
    )
    get().commitTracks(tracks, next, `split at ${time.toFixed(1)}`, [])
  },

  // ── moveClip ────────────────────────────────────────────────────────────────
  moveClip(clipId, newOutputStart, newTrackId) {
    const { tracks } = get()
    const srcTrack = tracks.find((t) => t.clips.some((c) => c.id === clipId))
    if (!srcTrack) return
    const destId = newTrackId ?? srcTrack.id
    if (!tracks.some((track) => track.id === destId)) return
    const placement = planClipPlacement(tracks, [clipId], clipId, newOutputStart, destId, {
      insert: false,
    })
    if (placement) get().commitTracks(tracks, placement.tracks, `move clip ${clipId}`, [clipId])
  },

  commitTracks(expected, next, label, selectedIds, synchronized = false) {
    const state = get()
    if (state.tracks !== expected || tracksEqual(expected, next)) return false
    if (!synchronized) {
      if (
        expected.some(
          (track) =>
            linkedMasterForTrack(next, track.id) &&
            linkedMasterForTrack(expected, track.id) &&
            JSON.stringify(track) !== JSON.stringify(next.find((item) => item.id === track.id)),
        )
      )
        return false
      next = synchronizeMixEdits(expected, next)
    }
    // Active substitutions cannot become ambiguous or lose their raw source coverage.
    for (const track of next)
      for (const clip of track.clips)
        for (const override of clip.sourceOverrides ?? []) {
          const start = Math.max(clip.sourceStart, override.sourceStart)
          const end = Math.min(clip.sourceEnd, override.sourceEnd)
          if (
            end > start &&
            !changeMixSources(
              next,
              track.id,
              clip.outputStart + start - clip.sourceStart,
              clip.outputStart + end - clip.sourceStart,
              override.stemTrackIds,
            )
          )
            return false
        }
    for (const track of next.filter((track) => linkedMasterForTrack(next, track.id)))
      for (const clip of track.clips) {
        const source = state.audioSources.find((source) => source.id === clip.audioSourceId)
        if (
          clip.sourceStart < 0 ||
          (source && clip.sourceEnd > source.metadata.durationSeconds + 1e-8)
        )
          return false
      }
    const ids = selectedIds ?? state.selectedClipIds
    const primary =
      selectedIds === undefined && state.selectedClipId ? state.selectedClipId : selectedIds?.[0]
    const selection = normalizedSelection(next, ids, primary)
    const selectedTrackId = selection.selectedClipId
      ? (next.find((track) => track.clips.some((clip) => clip.id === selection.selectedClipId))
          ?.id ?? state.selectedTrackId)
      : state.selectedTrackId
    set((current) => ({
      tracks: next,
      undoStack: [...current.undoStack, { before: cloneTracks(expected), label }],
      redoStack: [],
      ...selection,
      selectedTrackId,
    }))
    markTimelineEdited()
    return true
  },

  // ── selectedClipId ──────────────────────────────────────────────────────────
  setSelectedClipId(id) {
    get().setSelectedClipIds(id ? [id] : [], id ?? undefined)
  },

  setSelectedClipIds(ids, primaryId) {
    set((state) => normalizedSelection(state.tracks, ids, primaryId))
  },

  selectRedaction(clipId, redactionId) {
    const track = get().tracks.find((t) =>
      t.clips.some((c) => c.id === clipId && c.redactions?.some((r) => r.id === redactionId)),
    )
    if (!track) return
    set({
      selectedClipId: null,
      selectedClipIds: [],
      selectedTrackId: track.id,
      timelineSelection: { kind: 'redaction', clipId, redactionId },
    })
  },

  setCrossfadeEditing(clipId, redactionId, editing) {
    const selection = get().timelineSelection
    if (
      !editing &&
      (selection?.kind !== 'redaction' ||
        selection.clipId !== clipId ||
        selection.redactionId !== redactionId)
    )
      return
    if (editing) get().selectRedaction(clipId, redactionId)
    const current = get().timelineSelection
    if (
      current?.kind === 'redaction' &&
      current.clipId === clipId &&
      current.redactionId === redactionId
    ) {
      set({ timelineSelection: { ...current, editingCrossfade: editing } })
    }
  },

  updateRedactionCrossfade(clipId, redactionId, settings) {
    if (isLinkedClip(get().tracks, clipId)) return
    const parsed = CrossfadeSettingsSchema.safeParse(settings)
    if (!parsed.success) return
    const { tracks } = get()
    const redaction = tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId)
      ?.redactions?.find((r) => r.id === redactionId)
    if (!redaction || JSON.stringify(redaction.crossfade) === JSON.stringify(parsed.data)) return
    set((s) => ({
      tracks: tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                redactions: c.redactions?.map((r) =>
                  r.id === redactionId ? { ...r, crossfade: { ...parsed.data } } : r,
                ),
              }
            : c,
        ),
      })),
      undoStack: [...s.undoStack, { before: cloneTracks(tracks), label: 'Edit crossfade' }],
      redoStack: [],
    }))
    markTimelineEdited()
  },

  updateRedaction(clipId, redactionId, range, mode = 'resize') {
    if (isLinkedClip(get().tracks, clipId)) return
    const { tracks } = get()
    const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    const redaction = clip?.redactions?.find((r) => r.id === redactionId)
    // A translation keeps hidden trim metadata and the original duration.
    // It cannot move the visible part beyond the clip or extend hidden overhang.
    const delta = redaction ? range.sourceStart - redaction.sourceStart : 0
    const validMove =
      clip &&
      redaction &&
      mode === 'move' &&
      Math.abs(range.sourceEnd - redaction.sourceEnd - delta) < 1e-9 &&
      range.sourceStart >= Math.min(clip.sourceStart, redaction.sourceStart) &&
      range.sourceEnd <= Math.max(clip.sourceEnd, redaction.sourceEnd)
    if (
      !clip ||
      !redaction ||
      !Number.isFinite(range.sourceStart) ||
      !Number.isFinite(range.sourceEnd) ||
      (mode === 'move' && !validMove) ||
      (!validMove &&
        range.sourceStart !== redaction.sourceStart &&
        (range.sourceStart < clip.sourceStart || range.sourceStart >= clip.sourceEnd)) ||
      (!validMove &&
        range.sourceEnd !== redaction.sourceEnd &&
        (range.sourceEnd > clip.sourceEnd || range.sourceEnd <= clip.sourceStart)) ||
      range.sourceEnd <= range.sourceStart ||
      (range.sourceStart === redaction.sourceStart && range.sourceEnd === redaction.sourceEnd)
    )
      return
    set((s) => ({
      tracks: tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                redactions: c.redactions?.map((r) =>
                  r.id === redactionId ? { ...r, ...range } : r,
                ),
              }
            : c,
        ),
      })),
      undoStack: [...s.undoStack, { before: cloneTracks(tracks), label: 'Edit redaction' }],
      redoStack: [],
    }))
    markTimelineEdited()
  },

  removeRedaction(clipId, redactionId) {
    if (isLinkedClip(get().tracks, clipId)) return
    const { tracks } = get()
    if (
      !tracks.some((t) =>
        t.clips.some((c) => c.id === clipId && c.redactions?.some((r) => r.id === redactionId)),
      )
    )
      return
    set((s) => ({
      tracks: tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                redactions: c.redactions?.filter((r) => r.id !== redactionId),
              }
            : c,
        ),
      })),
      undoStack: [...s.undoStack, { before: cloneTracks(tracks), label: 'Remove redaction' }],
      redoStack: [],
      timelineSelection: null,
    }))
    markTimelineEdited()
  },

  setClipMuted(clipId, muted) {
    get().setClipsMuted([clipId], muted)
  },

  setClipsMuted(ids, muted) {
    const { tracks } = get()
    const selected = new Set(ids.filter((id) => !isLinkedClip(tracks, id)))
    if (
      !tracks.some((track) =>
        track.clips.some((clip) => selected.has(clip.id) && clip.muted !== muted),
      )
    )
      return
    const next = tracks.map((track) => {
      if (!track.clips.some((clip) => selected.has(clip.id) && clip.muted !== muted)) return track
      return {
        ...track,
        clips: track.clips.map((clip) =>
          selected.has(clip.id) && clip.muted !== muted ? { ...clip, muted } : clip,
        ),
      }
    })
    get().commitTracks(tracks, next, muted ? 'Mute clips' : 'Unmute clips')
  },

  setSnappingEnabled(enabled) {
    set({ snappingEnabled: enabled })
  },

  setInsertMode(enabled) {
    set({ insertMode: enabled })
  },

  // ── selectedTrackId ─────────────────────────────────────────────────────────
  setSelectedTrackId(id) {
    set({ selectedTrackId: id })
  },

  // ── undo ────────────────────────────────────────────────────────────────────
  recordDomainEdit(edit) {
    set((state) => ({
      undoStack: [
        ...state.undoStack,
        { before: cloneTracks(state.tracks), label: edit.label, domainEdit: edit },
      ],
      redoStack: [],
    }))
  },

  undo() {
    if (useEditorHistoryStore.getState().busy) return
    const { undoStack, tracks } = get()
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]
    if (entry.domainEdit) return useEditorHistoryStore.getState().perform(entry.domainEdit, 'undo')

    // Capture current state as a redo entry so we can re-apply this op.
    // The redo entry's `before` is the state we are about to revert FROM (i.e. current tracks),
    const redoEntry: HistoryEntry = {
      before: cloneTracks(tracks),
      label: entry.label,
    }

    set((s) => ({
      tracks: entry.before,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, redoEntry],
      selectedClipId: null,
      selectedClipIds: [],
      timelineSelection: null,
    }))
    markTimelineEdited()
  },

  // ── redo ────────────────────────────────────────────────────────────────────
  redo() {
    if (useEditorHistoryStore.getState().busy) return
    const { redoStack, tracks } = get()
    if (redoStack.length === 0) return
    const entry = redoStack[redoStack.length - 1]
    if (entry.domainEdit) return useEditorHistoryStore.getState().perform(entry.domainEdit, 'redo')

    // Capture current (pre-redo) state as an undo entry so the user can undo again.
    const undoEntry: HistoryEntry = {
      before: cloneTracks(tracks),
      label: entry.label,
    }

    set((s) => ({
      tracks: entry.before,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, undoEntry],
      selectedClipId: null,
      selectedClipIds: [],
      timelineSelection: null,
    }))
    markTimelineEdited()
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
    set((state) => ({ ...initialState, projectGeneration: state.projectGeneration + 1 }))
  },
}))

// ── Clip surgery helpers ───────────────────────────────────────────────────────

/** Add source-relative overlays, preserving the underlying clip occurrences. */
function addRedactions(clips: Clip[], startTime: number, endTime: number, trackId: string): Clip[] {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return clips
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
    if (redactionCoverage(clip, effectiveMuteStart, effectiveMuteEnd) === 'full') {
      result.push(clip)
      continue
    }

    result.push({
      ...clip,
      trackId,
      redactions: [
        ...(clip.redactions ?? []),
        {
          id: nextId('redaction'),
          sourceStart: effectiveMuteStart,
          sourceEnd: effectiveMuteEnd,
          crossfade: { ...DEFAULT_CROSSFADE_SETTINGS },
        },
      ],
    })
  }

  return result
}
