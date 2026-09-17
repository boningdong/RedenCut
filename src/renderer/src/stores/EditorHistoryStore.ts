import { create } from 'zustand'
import { useTimelineStore } from './timeline.store'

export interface DomainHistoryEdit {
  id: string
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}
interface EditorHistoryState {
  busy: boolean
  error: 'failed' | null
  record: (edit: Omit<DomainHistoryEdit, 'id'>) => void
  perform: (edit: DomainHistoryEdit, direction: 'undo' | 'redo') => Promise<void>
  reset: () => void
}
let nextHistoryId = 0
/** Domain callbacks share timeline chronology but never restore timeline snapshots. */
export const useEditorHistoryStore = create<EditorHistoryState>((set, get) => ({
  busy: false,
  error: null,
  record(edit) {
    useTimelineStore.getState().recordDomainEdit({ ...edit, id: `domain-${++nextHistoryId}` })
    set({ error: null })
  },
  async perform(edit, direction) {
    if (get().busy) return
    const generation = useTimelineStore.getState().projectGeneration
    set({ busy: true, error: null })
    try {
      await edit[direction]()
      if (useTimelineStore.getState().projectGeneration !== generation) return
      useTimelineStore.setState((state) => {
        const source = direction === 'undo' ? state.undoStack : state.redoStack
        const target = direction === 'undo' ? state.redoStack : state.undoStack
        const index = source.findIndex((entry) => entry.domainEdit?.id === edit.id)
        if (index < 0)
          return direction === 'redo'
            ? {
                undoStack: [
                  ...state.undoStack,
                  { before: structuredClone(state.tracks), label: edit.label, domainEdit: edit },
                ],
                redoStack: [],
              }
            : state
        const entry = source[index]
        const remaining = source.filter((_, i) => i !== index)
        // Edits completed while IPC was running invalidate the old redo future.
        const transferred = index === source.length - 1 ? [...target, entry] : target
        return direction === 'undo'
          ? { undoStack: remaining, redoStack: transferred }
          : { redoStack: remaining, undoStack: transferred }
      })
    } catch {
      if (useTimelineStore.getState().projectGeneration === generation) set({ error: 'failed' })
    } finally {
      set({ busy: false })
    }
  },
  reset: () => set({ busy: false, error: null }),
}))
