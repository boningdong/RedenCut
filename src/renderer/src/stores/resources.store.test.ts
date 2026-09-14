import { expect, it, vi } from 'vitest'
import { createResourcesStore } from './resources.store'
import type { IElectronAPI } from '@shared/ipc.types'
import type { ResourceSnapshot } from '@shared/resources.types'
import type { ModelAccessSnapshot } from '@shared/modelAccess.types'
it('subscribes before hydration and protects newer download and access events', async () => {
  let resolveResources!: (value: ResourceSnapshot) => void
  let resolveAccess!: (value: ModelAccessSnapshot) => void
  let resourceListener!: (value: ResourceSnapshot) => void
  let accessListener!: (value: ModelAccessSnapshot) => void
  const unsubscribe = vi.fn()
  const api = {
    resourcesGet: vi.fn(
      () =>
        new Promise<ResourceSnapshot>((resolve) => {
          resolveResources = resolve
        }),
    ),
    modelAccessGet: vi.fn(
      () =>
        new Promise<ModelAccessSnapshot>((resolve) => {
          resolveAccess = resolve
        }),
    ),
    onResourcesChanged: (listener: typeof resourceListener) => {
      resourceListener = listener
      return unsubscribe
    },
    onModelAccessChanged: (listener: typeof accessListener) => {
      accessListener = listener
      return unsubscribe
    },
  } as unknown as IElectronAPI
  const store = createResourcesStore(() => api)
  const hydration = store.getState().hydrate()
  const newer: ResourceSnapshot = { revision: 2, baseReady: true, resources: [] }
  resourceListener(newer)
  accessListener({ status: 'granted', hasToken: true })
  resolveResources({ revision: 1, baseReady: false, resources: [] })
  resolveAccess({ status: 'unchecked', hasToken: false })
  await hydration
  expect(store.getState().snapshot).toEqual(newer)
  expect(store.getState().access.status).toBe('granted')
  store.getState().dispose()
  expect(unsubscribe).toHaveBeenCalledTimes(2)
  resourceListener({ revision: 3, baseReady: false, resources: [] })
  expect(store.getState().snapshot).toEqual(newer)
})
it('ends verification with a recoverable error if IPC fails and never prepares automatically', async () => {
  const api = {
    modelAccessVerify: vi.fn().mockRejectedValue(new Error('transport failed')),
    resourcesPrepare: vi.fn(),
  } as unknown as IElectronAPI
  const store = createResourcesStore(() => api)
  await store.getState().verify('hf_secret')
  expect(store.getState().access.status).toBe('network-error')
  expect(store.getState().pending).toBe(false)
  expect(api.resourcesPrepare).not.toHaveBeenCalled()
  expect(JSON.stringify(store.getState())).not.toContain('hf_secret')
})
