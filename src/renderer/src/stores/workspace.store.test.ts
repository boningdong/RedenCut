// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IElectronAPI } from '@shared/ipc.types'
import { DEFAULT_WORKSPACE_LAYOUT, type WorkspaceLayout } from '@shared/workspaceLayout.types'

const audioFirst: WorkspaceLayout = {
  version: 1,
  contentOrder: ['audio', 'transcript'],
  transcriptRatio: 0.4,
  transportPosition: 'top',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function loadStore(api: IElectronAPI) {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  vi.resetModules()
  return (await import('./workspace.store')).useWorkspaceStore
}

function createApi(
  get: IElectronAPI['workspaceLayout']['get'],
  set: IElectronAPI['workspaceLayout']['set'],
): IElectronAPI {
  return { workspaceLayout: { get, set } } as IElectronAPI
}

describe('workspace store', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('hydrates once and exposes a recovery warning', async () => {
    const get = vi.fn(async () => ({
      layout: audioFirst,
      warning: { reason: 'workspace-recovered' as const },
    }))
    const store = await loadStore(createApi(get, vi.fn()))

    await Promise.all([store.getState().hydrate(), store.getState().hydrate()])
    await store.getState().hydrate()

    expect(get).toHaveBeenCalledTimes(1)
    expect(store.getState()).toMatchObject({
      layout: audioFirst,
      hydrated: true,
      warning: { reason: 'workspace-recovered' as const },
      error: null,
    })
  })

  it('keeps a local choice made while hydration is pending', async () => {
    const hydration = deferred<Awaited<ReturnType<IElectronAPI['workspaceLayout']['get']>>>()
    const store = await loadStore(
      createApi(
        vi.fn(() => hydration.promise),
        vi.fn(async (x) => x),
      ),
    )

    const hydrating = store.getState().hydrate()
    store.getState().updateLayout(audioFirst)
    hydration.resolve({
      layout: DEFAULT_WORKSPACE_LAYOUT,
      warning: { reason: 'workspace-invalid' },
    })
    await hydrating

    expect(store.getState().layout).toEqual(audioFirst)
    expect(store.getState().warning).toBeNull()
    expect(store.getState().hydrated).toBe(true)
  })

  it('finishes hydration with an error when loading preferences fails', async () => {
    const store = await loadStore(
      createApi(
        vi.fn(async () => Promise.reject(new Error('read denied'))),
        vi.fn(),
      ),
    )

    await store.getState().hydrate()

    expect(store.getState()).toMatchObject({
      layout: DEFAULT_WORKSPACE_LAYOUT,
      hydrated: true,
      warning: null,
      errorKind: 'load',
    })
    expect(store.getState().error).toEqual({ reason: 'workspace-load' })
  })

  it('serializes saves and coalesces unsent changes to the latest layout', async () => {
    const firstSave = deferred<WorkspaceLayout>()
    const set = vi
      .fn<IElectronAPI['workspaceLayout']['set']>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async (layout) => layout)
    const store = await loadStore(
      createApi(
        vi.fn(async () => ({ layout: DEFAULT_WORKSPACE_LAYOUT, warning: null })),
        set,
      ),
    )
    const middle: WorkspaceLayout = { ...audioFirst, transcriptRatio: 0.5 }
    const latest: WorkspaceLayout = { ...audioFirst, transcriptRatio: 0.7 }

    store.getState().updateLayout(audioFirst)
    store.getState().updateLayout(middle)
    store.getState().updateLayout(latest)
    expect(set).toHaveBeenCalledTimes(1)
    expect(store.getState().saving).toBe(true)

    firstSave.resolve(audioFirst)
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set.mock.calls[1]?.[0]).toEqual(latest)
    await vi.waitFor(() => expect(store.getState().saving).toBe(false))
    expect(store.getState().layout).toEqual(latest)
  })

  it('snapshots completed changes before exposing or queueing them', async () => {
    const firstSave = deferred<WorkspaceLayout>()
    const set = vi
      .fn<IElectronAPI['workspaceLayout']['set']>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async (layout) => layout)
    const store = await loadStore(
      createApi(
        vi.fn(async () => ({ layout: DEFAULT_WORKSPACE_LAYOUT, warning: null })),
        set,
      ),
    )
    const mutableFirst = structuredClone(audioFirst)
    const mutableLatest: WorkspaceLayout = { ...structuredClone(audioFirst), transcriptRatio: 0.7 }

    store.getState().updateLayout(mutableFirst)
    store.getState().updateLayout(mutableLatest)
    mutableFirst.contentOrder.reverse()
    mutableLatest.contentOrder.reverse()
    mutableLatest.transcriptRatio = 0.2

    expect(store.getState().layout).toEqual({ ...audioFirst, transcriptRatio: 0.7 })
    firstSave.resolve(audioFirst)
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set.mock.calls[1]?.[0]).toEqual({ ...audioFirst, transcriptRatio: 0.7 })
  })

  it('drains a change queued while a completed save loop is cleaning up', async () => {
    const firstSave = deferred<WorkspaceLayout>()
    const set = vi
      .fn<IElectronAPI['workspaceLayout']['set']>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async (layout) => layout)
    const store = await loadStore(
      createApi(
        vi.fn(async () => ({ layout: DEFAULT_WORKSPACE_LAYOUT, warning: null })),
        set,
      ),
    )
    const latest: WorkspaceLayout = { ...audioFirst, transcriptRatio: 0.7 }

    store.getState().updateLayout(audioFirst)
    firstSave.resolve(audioFirst)
    queueMicrotask(() => store.getState().updateLayout(latest))

    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set.mock.calls[1]?.[0]).toEqual(latest)
    await vi.waitFor(() => expect(store.getState().saving).toBe(false))
  })

  it('retains the latest layout after failure and retries that layout', async () => {
    const failedSave = deferred<WorkspaceLayout>()
    const set = vi
      .fn<IElectronAPI['workspaceLayout']['set']>()
      .mockImplementationOnce(() => failedSave.promise)
      .mockImplementation(async (layout) => layout)
    const store = await loadStore(
      createApi(
        vi.fn(async () => ({ layout: DEFAULT_WORKSPACE_LAYOUT, warning: null })),
        set,
      ),
    )
    const latest: WorkspaceLayout = { ...audioFirst, transcriptRatio: 0.8 }

    store.getState().updateLayout(audioFirst)
    store.getState().updateLayout(latest)
    failedSave.reject(new Error('disk unavailable'))
    await vi.waitFor(() => expect(store.getState().saving).toBe(false))

    expect(store.getState().layout).toEqual(latest)
    expect(store.getState().error).toEqual({ reason: 'workspace-save' })
    expect(store.getState().errorKind).toBe('save')
    expect(set).toHaveBeenCalledTimes(1)

    store.getState().retrySave()
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set.mock.calls[1]?.[0]).toEqual(latest)
    await vi.waitFor(() => expect(store.getState().error).toBeNull())
    expect(store.getState().errorKind).toBeNull()
  })

  it('drains an explicit retry queued while a failed save loop is cleaning up', async () => {
    const firstSave = deferred<WorkspaceLayout>()
    const set = vi
      .fn<IElectronAPI['workspaceLayout']['set']>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async (layout) => layout)
    const store = await loadStore(
      createApi(
        vi.fn(async () => ({ layout: DEFAULT_WORKSPACE_LAYOUT, warning: null })),
        set,
      ),
    )

    store.getState().updateLayout(audioFirst)
    firstSave.reject(new Error('disk unavailable'))
    queueMicrotask(() => store.getState().retrySave())

    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    expect(set.mock.calls[1]?.[0]).toEqual(audioFirst)
    await vi.waitFor(() => expect(store.getState().saving).toBe(false))
    expect(store.getState().error).toBeNull()
  })

  it('resets to defaults and persists the reset', async () => {
    const set = vi.fn(async (layout: WorkspaceLayout) => layout)
    const store = await loadStore(
      createApi(
        vi.fn(async () => ({ layout: audioFirst, warning: null })),
        set,
      ),
    )
    await store.getState().hydrate()

    store.getState().resetLayout()

    expect(store.getState().layout).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    expect(set).toHaveBeenCalledWith(DEFAULT_WORKSPACE_LAYOUT)
  })
})
