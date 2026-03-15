// ─────────────────────────────────────────────────────────────────────────────
// Editor Store (Zustand)
//
// Owns all non-playback editor state:
//   • The current project file + its save path
//   • The edit list (muted/cut regions — non-destructive)
//   • The current waveform time-range selection
//   • Preview Mode toggle (skip muted regions during playback)
//   • Undo stack: each entry stores the Edit + the word IDs that were
//     muted together, so undo can reverse both the audio region and the
//     transcript strikethrough in one step.
//   • selectedEditId: the edit region the user clicked on the waveform
//
// Separation of concerns:
//   • playback.store  — isPlaying, currentTime, duration (changes at 60fps)
//   • editor.store    — edits, selection, project state (changes on user action)
//   • transcript.store — words, word selection (changes on user action)
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'
import type { Edit, ProjectFile } from '@shared/project.types'
import { useTranscriptStore } from './transcript.store'

export interface TimeRange {
  start: number
  end: number
}

/** One undoable step: the edit that was added + the transcript words that were
 *  muted at the same time.  wordIds is empty for pure-audio edits (M key). */
interface HistoryEntry {
  edit: Edit
  wordIds: string[]
}

interface EditorState {
  // ── Project ────────────────────────────────────────────────────────────────
  /** Path where the project file is saved. null = unsaved new project. */
  projectPath: string | null
  /** True when there are unsaved changes. */
  isDirty: boolean
  /** The full project data (null until a file is opened). */
  project: ProjectFile | null

  // ── Edit model ─────────────────────────────────────────────────────────────
  /** Non-destructive edits — muted/cut regions on the timeline. */
  edits: Edit[]

  // ── Selection ──────────────────────────────────────────────────────────────
  /** The active time-range selection on the waveform (null = nothing selected). */
  selection: TimeRange | null

  // ── Selected edit region ───────────────────────────────────────────────────
  /** ID of the edit region the user has clicked on the waveform. */
  selectedEditId: string | null

  // ── Preview Mode ───────────────────────────────────────────────────────────
  /**
   * When true, playback automatically skips muted regions — simulating
   * the final export. If the playhead is inside a muted region when Play
   * is pressed, it jumps to the end of that region immediately.
   */
  previewMode: boolean

  // ── Undo history ───────────────────────────────────────────────────────────
  undoStack: HistoryEntry[]

  // ── Actions ────────────────────────────────────────────────────────────────
  setProjectPath: (path: string | null) => void
  setIsDirty: (dirty: boolean) => void
  setProject: (project: ProjectFile | null) => void

  /** Replace the entire edits array (e.g. after loading a project). Does NOT
   *  push to the undo stack — loading is not an undoable user action. */
  setEdits: (edits: Edit[]) => void

  /**
   * Add a new mute/cut edit and push it onto the undo stack.
   * @param wordIds  IDs of transcript words muted together with this edit
   *                 (empty for pure-audio waveform edits).
   */
  addEdit: (edit: Omit<Edit, 'id'>, wordIds?: string[]) => void

  /** Remove an edit by id without touching the undo stack (used by U-key
   *  overlap-removal when no word association is needed). */
  removeEdit: (id: string) => void

  /**
   * Remove a specific edit by ID and reverse its associated word mutes.
   * Finds the entry in the undo stack (if present) to recover wordIds,
   * then removes the edit and un-mutes those words.
   */
  removeEditWithUndo: (id: string) => void

  /** Update fields of an existing edit. Marks project dirty. */
  updateEdit: (id: string, patch: Partial<Omit<Edit, 'id'>>) => void

  setSelection: (sel: TimeRange | null) => void

  /** Set the currently selected edit region (clicked on the waveform). */
  setSelectedEditId: (id: string | null) => void

  togglePreviewMode: () => void

  /** Undo the most recent addEdit: removes the edit and un-mutes its words. */
  undo: () => void

  /** Reset to initial state (called when opening a new file). */
  reset: () => void
}

const initialState = {
  projectPath: null,
  isDirty: false,
  project: null,
  edits: [] as Edit[],
  selection: null,
  selectedEditId: null,
  previewMode: false,
  undoStack: [] as HistoryEntry[],
}

let _editIdCounter = 0

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...initialState,

  setProjectPath: (path) => set({ projectPath: path }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  setProject: (project) => set({ project }),

  setEdits: (edits) => set({ edits }),

  addEdit: (editPartial, wordIds = []) => {
    const id = `edit-${++_editIdCounter}-${Date.now()}`
    const edit = { ...editPartial, id } as Edit
    set((s) => ({
      edits: [...s.edits, edit],
      isDirty: true,
      undoStack: [...s.undoStack, { edit, wordIds }],
    }))
  },

  removeEdit: (id) =>
    set((s) => ({
      edits: s.edits.filter((e) => e.id !== id),
      isDirty: true,
    })),

  removeEditWithUndo: (id) => {
    const { undoStack } = get()
    const entry = undoStack.find((e) => e.edit.id === id)
    set((s) => ({
      edits: s.edits.filter((e) => e.id !== id),
      // Remove this entry from the undo stack so CMD+Z doesn't re-undo it
      undoStack: s.undoStack.filter((e) => e.edit.id !== id),
      selectedEditId: null,
      isDirty: true,
    }))
    if (entry && entry.wordIds.length > 0) {
      useTranscriptStore.getState().unmuteWords(entry.wordIds)
    }
  },

  updateEdit: (id, patch) =>
    set((s) => ({
      edits: s.edits.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      isDirty: true,
    })),

  setSelection: (sel) => set({ selection: sel }),

  setSelectedEditId: (id) => set({ selectedEditId: id }),

  togglePreviewMode: () => set((s) => ({ previewMode: !s.previewMode })),

  undo: () => {
    const { undoStack } = get()
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]
    set((s) => ({
      edits: s.edits.filter((e) => e.id !== entry.edit.id),
      undoStack: s.undoStack.slice(0, -1),
      isDirty: true,
    }))
    if (entry.wordIds.length > 0) {
      useTranscriptStore.getState().unmuteWords(entry.wordIds)
    }
  },

  reset: () => set({ ...initialState }),
}))
