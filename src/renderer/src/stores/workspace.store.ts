import { create } from 'zustand'
import {
  DEFAULT_WORKSPACE_LAYOUT,
  WorkspaceLayoutSchema,
  type WorkspaceLayout,
} from '@shared/workspaceLayout.types'

interface WorkspaceState {
  layout: WorkspaceLayout
  hydrated: boolean
  saving: boolean
  warning: string | null
  error: string | null
  errorKind: 'load' | 'save' | null
  hydrate: () => Promise<void>
  updateLayout: (layout: WorkspaceLayout) => void
  retrySave: () => void
  resetLayout: () => void
}

let editGeneration = 0
let hydrationPromise: Promise<void> | null = null
let pendingSave: WorkspaceLayout | null = null
let saveLoopPromise: Promise<void> | null = null

function errorMessage(action: 'loaded' | 'saved', error: unknown): string {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : ''
  return `Workspace layout could not be ${action}.${detail}`
}

function startSaveLoop(set: (state: Partial<WorkspaceState>) => void): void {
  if (saveLoopPromise) return

  set({ saving: true, error: null, errorKind: null })
  saveLoopPromise = (async () => {
    while (pendingSave) {
      const saving = pendingSave
      pendingSave = null
      try {
        await window.electronAPI.workspaceLayout.set(saving)
      } catch (error) {
        pendingSave = null
        set({ error: errorMessage('saved', error), errorKind: 'save' })
        break
      }
    }
  })().finally(() => {
    saveLoopPromise = null
    if (pendingSave) {
      startSaveLoop(set)
      return
    }
    set({ saving: false })
  })
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  layout: DEFAULT_WORKSPACE_LAYOUT,
  hydrated: false,
  saving: false,
  warning: null,
  error: null,
  errorKind: null,

  hydrate: () => {
    if (hydrationPromise) return hydrationPromise

    const generationAtStart = editGeneration
    hydrationPromise = window.electronAPI.workspaceLayout
      .get()
      .then(({ layout, warning }) => {
        if (editGeneration !== generationAtStart) {
          set({ hydrated: true })
          return
        }
        set({ layout, hydrated: true, warning, error: null, errorKind: null })
      })
      .catch((error: unknown) => {
        set({
          hydrated: true,
          ...(editGeneration === generationAtStart
            ? { error: errorMessage('loaded', error), errorKind: 'load' as const }
            : {}),
        })
      })
    return hydrationPromise
  },

  updateLayout: (layout) => {
    const snapshot = WorkspaceLayoutSchema.parse(layout)
    editGeneration += 1
    pendingSave = snapshot
    set({ layout: snapshot, warning: null })
    startSaveLoop(set)
  },

  retrySave: () => {
    pendingSave = WorkspaceLayoutSchema.parse(get().layout)
    startSaveLoop(set)
  },

  resetLayout: () => get().updateLayout(DEFAULT_WORKSPACE_LAYOUT),
}))
