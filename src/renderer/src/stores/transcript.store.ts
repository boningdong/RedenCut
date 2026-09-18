// ─────────────────────────────────────────────────────────────────────────────
// Transcript Store (Zustand)
//
// Owns the transcript state:
//   • The word list (with muted flags)
//   • The set of selected word IDs (for text-based region selection)
//   • Display toggle: show struck-through muted words, or hide them entirely
//
// The store is populated after a successful transcript:generate IPC call.
// Words are kept in the store even when muted — they are never deleted so
// that the user can undo mutes or adjust region boundaries.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import type { Word } from '@shared/project.types'
import type { RendererSpeechAnalysis } from '@shared/speech.types'

interface TranscriptState {
  followPlayback: boolean
  setFollowPlayback: (enabled: boolean) => void
  displayMode: 'continuous' | 'speakers'
  setDisplayMode: (mode: 'continuous' | 'speakers') => void
  hiddenSpeakerKeys: string[]
  toggleSpeakerVisibility: (key: string) => void
  analyses: RendererSpeechAnalysis[]
  selectedTranscriptUnitIds: Set<string>
  loadAnalyses: (analyses: RendererSpeechAnalysis[]) => void
  setSelectedTranscriptUnitIds: (ids: Set<string>) => void
  // ── Data ───────────────────────────────────────────────────────────────────
  words: Word[]

  /** IDs of words currently selected by the user in the transcript panel. */
  selectedWordIds: Set<string>

  /**
   * When true (default), muted words are rendered with strikethrough.
   * When false, muted words are hidden entirely (cleaner reading view).
   */
  showMutedWords: boolean

  /**
   * IDs of tracks whose words are currently visible.
   * Stored as string[] for JSON-serializability.
   * Empty array = no tracks have transcripts yet (show nothing).
   */
  visibleTrackIds: string[]

  /** Flip a track's visibility ON↔OFF. Calling twice returns to the original state. */
  toggleTrackVisibility: (trackId: string) => void

  /**
   * Ensure a track is visible. Called after generation so the new transcript
   * appears immediately. Idempotent — safe to call even if already visible.
   */
  ensureTrackVisible: (trackId: string) => void

  // ── Actions ────────────────────────────────────────────────────────────────
  setWords: (words: Word[]) => void

  /** Mark a single word as muted or unmuted. */
  setWordMuted: (id: string, muted: boolean) => void

  /** Mute a range of words by their IDs. */
  muteWords: (ids: string[]) => void

  /** Unmute a range of words by their IDs. */
  unmuteWords: (ids: string[]) => void

  setSelectedWordIds: (ids: Set<string>) => void
  clearSelection: () => void

  toggleShowMutedWords: () => void

  /**
   * Shifts every word's start and end timestamps by `offsetSeconds`.
   * Used for manual calibration: the user positions the playhead at the true
   * start of the first word, then the UI calls shiftTimestamps(currentTime - firstWord.start).
   * Timestamps are clamped to >= 0.
   */
  shiftTimestamps: (offsetSeconds: number) => void

  /**
   * Remove all words that belong to a specific track.
   * Called when a track is deleted. Atomically removes from both words
   * and visibleTrackIds.
   */
  removeWordsForTrack: (trackId: string) => void

  reset: () => void
}

const initialState = {
  followPlayback: false,
  displayMode: 'speakers' as 'continuous' | 'speakers',
  hiddenSpeakerKeys: [] as string[],
  analyses: [] as RendererSpeechAnalysis[],
  selectedTranscriptUnitIds: new Set<string>(),
  words: [] as Word[],
  selectedWordIds: new Set<string>(),
  showMutedWords: true,
  visibleTrackIds: [] as string[],
}

export const useTranscriptStore = create<TranscriptState>()((set) => ({
  ...initialState,
  setFollowPlayback: (followPlayback) => set({ followPlayback }),
  setDisplayMode: (displayMode) =>
    set({ displayMode, selectedTranscriptUnitIds: new Set(), selectedWordIds: new Set() }),
  toggleSpeakerVisibility: (key) =>
    set((s) => ({
      hiddenSpeakerKeys: s.hiddenSpeakerKeys.includes(key)
        ? s.hiddenSpeakerKeys.filter((k) => k !== key)
        : [...s.hiddenSpeakerKeys, key],
      selectedTranscriptUnitIds: new Set(),
    })),

  loadAnalyses: (analyses) => set({ analyses, selectedTranscriptUnitIds: new Set() }),
  setSelectedTranscriptUnitIds: (selectedTranscriptUnitIds) => set({ selectedTranscriptUnitIds }),

  setWords: (words) => set({ words }),

  setWordMuted: (id, muted) =>
    set((s) => ({
      words: s.words.map((w) => (w.id === id ? { ...w, muted } : w)),
    })),

  muteWords: (ids) => {
    const idSet = new Set(ids)
    set((s) => ({
      words: s.words.map((w) => (idSet.has(w.id) ? { ...w, muted: true } : w)),
    }))
  },

  unmuteWords: (ids) => {
    const idSet = new Set(ids)
    set((s) => ({
      words: s.words.map((w) => (idSet.has(w.id) ? { ...w, muted: false } : w)),
    }))
  },

  setSelectedWordIds: (ids) => set({ selectedWordIds: ids }),
  clearSelection: () => set({ selectedWordIds: new Set() }),

  toggleShowMutedWords: () => set((s) => ({ showMutedWords: !s.showMutedWords })),

  toggleTrackVisibility: (trackId) =>
    set((s) => ({
      visibleTrackIds: s.visibleTrackIds.includes(trackId)
        ? s.visibleTrackIds.filter((id) => id !== trackId)
        : [...s.visibleTrackIds, trackId],
    })),

  ensureTrackVisible: (trackId) =>
    set((s) => ({
      visibleTrackIds: s.visibleTrackIds.includes(trackId)
        ? s.visibleTrackIds
        : [...s.visibleTrackIds, trackId],
    })),

  shiftTimestamps: (offsetSeconds) =>
    set((s) => ({
      words: s.words.map((w) => ({
        ...w,
        start: Math.max(0, w.start + offsetSeconds),
        end: Math.max(0, w.end + offsetSeconds),
      })),
    })),

  removeWordsForTrack: (trackId) =>
    set((s) => ({
      words: s.words.filter((w) => w.trackId !== trackId),
      visibleTrackIds: s.visibleTrackIds.filter((id) => id !== trackId),
    })),

  reset: () => set(initialState),
}))
