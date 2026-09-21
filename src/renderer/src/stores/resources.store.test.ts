import { expect, it, vi } from 'vitest'
import { createResourcesStore } from './resources.store'
import type { IElectronAPI } from '@shared/ipc.types'
import type { ResourceSnapshot } from '@shared/resources.types'
it('subscribes before hydration and protects newer events and disposal without authentication', async () => {
  let resolve!: (value: ResourceSnapshot) => void
  let listener!: (value: ResourceSnapshot) => void
  const unsubscribe = vi.fn()
  const api = {
    resourcesGet: vi.fn(
      () =>
        new Promise<ResourceSnapshot>((done) => {
          resolve = done
        }),
    ),
    onResourcesChanged: (next: typeof listener) => {
      listener = next
      return unsubscribe
    },
  } as unknown as IElectronAPI
  const store = createResourcesStore(() => api)
  const hydration = store.getState().hydrate()
  const newer = { revision: 2, baseReady: true, resources: [] }
  listener(newer)
  resolve({ revision: 1, baseReady: false, resources: [] })
  await hydration
  expect(store.getState().snapshot).toEqual(newer)
  store.getState().dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
  listener({ revision: 3, baseReady: false, resources: [] })
  expect(store.getState().snapshot).toEqual(newer)
})
it('refresh errors are recoverable and never start a download', async () => {
  const api = {
    resourcesGet: vi.fn().mockRejectedValue(Error('transport')),
    resourcesPrepare: vi.fn(),
  } as unknown as IElectronAPI
  const store = createResourcesStore(() => api)
  await store.getState().refresh()
  expect(store.getState().error).toBe(true)
  expect(store.getState().pending).toBe(false)
  expect(api.resourcesPrepare).not.toHaveBeenCalled()
})
