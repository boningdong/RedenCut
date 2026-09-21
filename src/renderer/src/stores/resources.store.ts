import { create } from 'zustand'
import type { ResourceSnapshot, ResourcePreparation } from '@shared/resources.types'
import type { IElectronAPI } from '@shared/ipc.types'
interface ResourcesState {
  snapshot: ResourceSnapshot | null
  error: boolean
  pending: boolean
  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  selectWhisper: (modelId: string) => Promise<void>
  prepare: (target: ResourcePreparation) => Promise<void>
  cancel: () => Promise<void>
  dispose: () => void
}
export function createResourcesStore(getApi: () => IElectronAPI) {
  let subscriptions: (() => void)[] = []
  let hydration: Promise<void> | null = null
  let lifecycle = 0
  let pendingCount = 0
  return create<ResourcesState>()((set, get) => {
    const apply = (snapshot: ResourceSnapshot) => {
      if (snapshot.revision >= (get().snapshot?.revision ?? -1)) set({ snapshot })
    }
    const run = async (operation: () => Promise<unknown>) => {
      const generation = lifecycle
      pendingCount += 1
      set({ error: false, pending: true })
      try {
        await operation()
      } catch {
        if (generation === lifecycle) set({ error: true })
      } finally {
        if (generation === lifecycle) {
          pendingCount -= 1
          set({ pending: pendingCount > 0 })
        }
      }
    }
    const refresh = () =>
      run(async () => {
        const generation = lifecycle
        const snapshot = await getApi().resourcesGet()
        if (generation === lifecycle) apply(snapshot)
      })
    return {
      snapshot: null,
      error: false,
      pending: false,
      hydrate: () => {
        if (hydration) return hydration
        const api = getApi()
        const generation = lifecycle
        if (!subscriptions.length)
          subscriptions = [
            api.onResourcesChanged((value) => {
              if (generation === lifecycle) apply(value)
            }),
          ]
        hydration = run(async () => {
          const snapshot = await api.resourcesGet()
          if (generation === lifecycle) {
            apply(snapshot)
          }
        }).finally(() => {
          hydration = null
        })
        return hydration
      },
      refresh,
      selectWhisper: (modelId) =>
        run(async () => {
          const generation = lifecycle
          const snapshot = await getApi().resourcesSelectWhisper(modelId)
          if (generation === lifecycle) apply(snapshot)
        }),
      prepare: (target) =>
        run(async () => {
          const generation = lifecycle
          const snapshot = await getApi().resourcesPrepare(target)
          if (generation === lifecycle) apply(snapshot)
        }),
      cancel: () =>
        run(async () => {
          const generation = lifecycle
          const snapshot = await getApi().resourcesCancel()
          if (generation === lifecycle) apply(snapshot)
        }),
      dispose: () => {
        lifecycle += 1
        subscriptions.forEach((fn) => fn())
        subscriptions = []
        hydration = null
        pendingCount = 0
        set({ pending: false })
      },
    }
  })
}
export const useResourcesStore = createResourcesStore(() => window.electronAPI)
