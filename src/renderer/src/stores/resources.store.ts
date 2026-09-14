import { create } from 'zustand'
import type { ResourceSnapshot, ResourcePreparation } from '@shared/resources.types'
import type { ModelAccessSnapshot } from '@shared/modelAccess.types'
import type { IElectronAPI } from '@shared/ipc.types'
interface ResourcesState {
  snapshot: ResourceSnapshot | null
  access: ModelAccessSnapshot
  error: boolean
  pending: boolean
  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  prepare: (target: ResourcePreparation) => Promise<void>
  cancel: () => Promise<void>
  verifyLocal: () => Promise<void>
  verify: (token?: string) => Promise<void>
  clearToken: () => Promise<void>
  openConditions: () => Promise<void>
  dispose: () => void
}
export function createResourcesStore(getApi: () => IElectronAPI) {
  let subscriptions: (() => void)[] = []
  let hydration: Promise<void> | null = null
  let lifecycle = 0
  let accessRevision = 0
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
      access: { status: 'unchecked', hasToken: false },
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
            api.onModelAccessChanged((access) => {
              if (generation === lifecycle) {
                accessRevision += 1
                set({ access })
              }
            }),
          ]
        hydration = run(async () => {
          const revision = accessRevision
          const [snapshot, access] = await Promise.all([api.resourcesGet(), api.modelAccessGet()])
          if (generation === lifecycle) {
            apply(snapshot)
            if (revision === accessRevision) set({ access })
          }
        }).finally(() => {
          hydration = null
        })
        return hydration
      },
      refresh,
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
      verifyLocal: () =>
        run(async () => {
          const generation = lifecycle
          accessRevision += 1
          set({ access: { ...get().access, status: 'checking' } })
          try {
            const access = await getApi().modelAccessVerifyLocal()
            if (generation === lifecycle) set({ access })
          } catch {
            if (generation === lifecycle)
              set({ access: { ...get().access, status: 'network-error' } })
          }
        }),
      verify: (token) =>
        run(async () => {
          const generation = lifecycle
          accessRevision += 1
          set({ access: { ...get().access, status: 'checking' } })
          try {
            const access = await getApi().modelAccessVerify(token)
            if (generation === lifecycle) set({ access })
          } catch {
            if (generation === lifecycle)
              set({ access: { ...get().access, status: 'network-error' } })
          }
        }),
      clearToken: () =>
        run(async () => {
          const generation = lifecycle
          accessRevision += 1
          const access = await getApi().modelAccessClear()
          if (generation === lifecycle) set({ access })
        }),
      openConditions: () => run(() => getApi().modelAccessOpenConditions()),
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
