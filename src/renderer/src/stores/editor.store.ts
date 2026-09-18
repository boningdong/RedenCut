import { create } from 'zustand'
import type { RendererSession } from '@shared/session.types'

export interface EditorSelection {
  origin: 'timeline' | 'transcript' | 'clip'
  trackId: string | null
  start: number
  end: number
}

interface EditorState {
  session: RendererSession | null
  isDirty: boolean
  localEditRevision: number
  selection: EditorSelection | null
  previewMode: boolean
  loadSession: (session: RendererSession, preserveDirty?: boolean) => void
  markEdited: () => void
  acknowledgeSave: (session: RendererSession, capturedLocalEditRevision: number) => boolean
  setSelection: (selection: EditorSelection | null) => void
  togglePreviewMode: () => void
  reset: () => void
}

const initialState = {
  session: null as RendererSession | null,
  isDirty: false,
  localEditRevision: 0,
  selection: null as EditorSelection | null,
  previewMode: false,
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...initialState,

  loadSession: (session, preserveDirty = false) =>
    set((state) => ({
      session,
      isDirty: preserveDirty ? state.isDirty : false,
      localEditRevision: state.localEditRevision,
    })),

  markEdited: () =>
    set((state) => ({ isDirty: true, localEditRevision: state.localEditRevision + 1 })),

  acknowledgeSave: (session, capturedLocalEditRevision) => {
    const state = get()
    const unchanged = state.localEditRevision === capturedLocalEditRevision
    set({
      session:
        unchanged || !state.session
          ? session
          : {
              ...session,
              draft: state.session.draft,
            },
      isDirty: unchanged ? false : state.isDirty,
    })
    return unchanged
  },

  setSelection: (selection) => set({ selection }),
  togglePreviewMode: () => set((state) => ({ previewMode: !state.previewMode })),
  reset: () => set({ ...initialState }),
}))
