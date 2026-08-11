// ─────────────────────────────────────────────────────────────────────────────
// Editor Store (Zustand)
//
// Owns project-level state and ephemeral UI state that doesn't belong in the
// playback or timeline stores:
//   • The current project file + its save path
//   • The active waveform time-range selection (drag-selection)
//   • Preview Mode toggle (skip muted regions during playback)
//
// What moved OUT of this store:
//   • edits[] / undoStack → timeline.store (clip/track model)
//   • selectedEditId → timeline.store.selectedClipId
//   • Playback state → playback.store
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import type { ProjectFile } from '@shared/project.types'

export interface TimeRange {
  start: number
  end: number
}

interface EditorState {
  // ── Project ────────────────────────────────────────────────────────────────
  /** Path where the project file is saved. null = unsaved new project. */
  projectPath: string | null
  /** True when there are unsaved changes. */
  isDirty: boolean
  /** The full project data (null until a file is opened). */
  project: ProjectFile | null

  // ── Selection ──────────────────────────────────────────────────────────────
  /** The active time-range selection on the waveform (null = nothing selected). */
  selection: TimeRange | null

  // ── Preview Mode ───────────────────────────────────────────────────────────
  /**
   * When true, playback automatically skips muted regions — simulating
   * the final export. If the playhead is inside a muted region when Play
   * is pressed, it jumps to the end of that region immediately.
   */
  previewMode: boolean

  // ── Actions ────────────────────────────────────────────────────────────────
  setProjectPath: (path: string | null) => void
  setIsDirty: (dirty: boolean) => void
  setProject: (project: ProjectFile | null) => void

  setSelection: (sel: TimeRange | null) => void

  togglePreviewMode: () => void

  /** Reset to initial state (called when opening a new file). */
  reset: () => void
}

const initialState = {
  projectPath: null,
  isDirty: false,
  project: null,
  selection: null,
  previewMode: false,
}

export const useEditorStore = create<EditorState>()((set) => ({
  ...initialState,

  setProjectPath: (path) => set({ projectPath: path }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  setProject: (project) => set({ project }),

  setSelection: (sel) => set({ selection: sel }),

  togglePreviewMode: () => set((s) => ({ previewMode: !s.previewMode })),

  reset: () => set({ ...initialState }),
}))
