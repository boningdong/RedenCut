import { create } from 'zustand'
import type { RendererSession } from '@shared/session.types'

interface TimeRange {
  start: number
  end: number
}

interface EditorState {
  session: RendererSession | null
  isDirty: boolean
  localEditRevision: number
  selection: TimeRange | null
  previewMode: boolean
  loadSession: (session: RendererSession) => void
  markEdited: () => void
  acknowledgeSave: (session: RendererSession, capturedLocalEditRevision: number) => boolean
  setSelection: (selection: TimeRange | null) => void
  togglePreviewMode: () => void
  reset: () => void
}

const initialState = {
  session: null as RendererSession | null,
  isDirty: false,
  localEditRevision: 0,
  selection: null as TimeRange | null,
  previewMode: false,
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...initialState,

  loadSession: (session) =>
    set((state) => ({
      session,
      isDirty: false,
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
