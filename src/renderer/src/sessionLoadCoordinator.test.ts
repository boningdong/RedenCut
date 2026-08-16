import { describe, expect, it, vi } from 'vitest'
import { createSessionLoadCoordinator } from './sessionLoadCoordinator'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('session load coordinator', () => {
  it('destroys a stale prepared resource and never commits it over the latest session', async () => {
    const first = deferred<{ name: string; destroy: () => void }>()
    const second = deferred<{ name: string; destroy: () => void }>()
    const commit = vi.fn()
    const coordinator = createSessionLoadCoordinator(
      (name: string) => (name === 'first' ? first.promise : second.promise),
      commit,
      (resource) => resource.destroy(),
    )
    const firstLoad = coordinator.load('first')
    const secondLoad = coordinator.load('second')
    const firstResource = { name: 'first', destroy: vi.fn() }
    const secondResource = { name: 'second', destroy: vi.fn() }

    second.resolve(secondResource)
    await expect(secondLoad).resolves.toBe(true)
    first.resolve(firstResource)
    await expect(firstLoad).resolves.toBe(false)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('second', secondResource)
    expect(firstResource.destroy).toHaveBeenCalledTimes(1)
    expect(secondResource.destroy).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight load during teardown', async () => {
    const prepared = deferred<{ destroy: () => void }>()
    const commit = vi.fn()
    const coordinator = createSessionLoadCoordinator(
      () => prepared.promise,
      commit,
      (resource) => resource.destroy(),
    )
    const loading = coordinator.load('session')
    const resource = { destroy: vi.fn() }

    coordinator.invalidate()
    prepared.resolve(resource)
    await expect(loading).resolves.toBe(false)

    expect(resource.destroy).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
  })

  it('suppresses a stale preparation failure after a newer session commits', async () => {
    const first = deferred<{ destroy: () => void }>()
    const second = deferred<{ destroy: () => void }>()
    const commit = vi.fn()
    const coordinator = createSessionLoadCoordinator(
      (name: string) => (name === 'first' ? first.promise : second.promise),
      commit,
      (resource) => resource.destroy(),
    )
    const firstLoad = coordinator.load('first')
    const secondLoad = coordinator.load('second')
    const latest = { destroy: vi.fn() }

    second.resolve(latest)
    await expect(secondLoad).resolves.toBe(true)
    first.reject(new Error('stale provider failed'))

    await expect(firstLoad).resolves.toBe(false)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
