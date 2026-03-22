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

interface TranscriptState {
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
   * When non-null, only words from this sourceFileId are shown.
   * null = all tracks merged.
   */
  activeTrackFilter: string | null

  setActiveTrackFilter: (sourceFileId: string | null) => void

  /** True while a transcription job is running. */
  isGenerating: boolean

  /** Status string pushed from the main process during transcription. */
  generatingStatus: string

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

  setIsGenerating: (generating: boolean) => void
  setGeneratingStatus: (status: string) => void

  /**
   * Shifts every word's start and end timestamps by `offsetSeconds`.
   * Used for manual calibration: the user positions the playhead at the true
   * start of the first word, then the UI calls shiftTimestamps(currentTime - firstWord.start).
   * Timestamps are clamped to >= 0.
   */
  shiftTimestamps: (offsetSeconds: number) => void

  reset: () => void
}

const initialState = {
  words: [] as Word[],
  selectedWordIds: new Set<string>(),
  showMutedWords: true,
  activeTrackFilter: null as string | null,
  isGenerating: false,
  generatingStatus: '',
}

export const useTranscriptStore = create<TranscriptState>()((set) => ({
  ...initialState,

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

  toggleShowMutedWords: () =>
    set((s) => ({ showMutedWords: !s.showMutedWords })),

  setActiveTrackFilter: (sourceFileId: string | null) => set({ activeTrackFilter: sourceFileId }),

  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setGeneratingStatus: (status) => set({ generatingStatus: status }),

  shiftTimestamps: (offsetSeconds) =>
    set((s) => ({
      words: s.words.map((w) => ({
        ...w,
        start: Math.max(0, w.start + offsetSeconds),
        end:   Math.max(0, w.end   + offsetSeconds),
      })),
    })),

  reset: () => set(initialState),
}))
