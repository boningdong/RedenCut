import { describe, expect, it, vi } from 'vitest'
import { AsyncMutex } from './AsyncMutex'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('AsyncMutex', () => {
  it('rejects an already-aborted caller without entering its body', async () => {
    const mutex = new AsyncMutex()
    const controller = new AbortController()
    const operation = vi.fn()
    controller.abort()

    await expect(mutex.runExclusive(operation, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(operation).not.toHaveBeenCalled()
  })

  it('removes an aborted queued caller without disturbing FIFO ownership', async () => {
    const mutex = new AsyncMutex()
    const releaseFirst = deferred()
    const firstEntered = deferred()
    const events: string[] = []
    const first = mutex.runExclusive(async () => {
      events.push('first')
      firstEntered.resolve()
      await releaseFirst.promise
    })
    await firstEntered.promise
    const controller = new AbortController()
    const aborted = mutex.runExclusive(() => events.push('aborted'), controller.signal)
    const third = mutex.runExclusive(() => events.push('third'))

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    expect(events).toEqual(['first'])
    releaseFirst.resolve()
    await Promise.all([first, third])
    expect(events).toEqual(['first', 'third'])
  })

  it('does not release a caller that aborts after entering', async () => {
    const mutex = new AsyncMutex()
    const controller = new AbortController()
    const releaseFirst = deferred()
    const firstEntered = deferred()
    const events: string[] = []
    const first = mutex.runExclusive(async () => {
      events.push('first')
      firstEntered.resolve()
      await releaseFirst.promise
    }, controller.signal)
    await firstEntered.promise
    const second = mutex.runExclusive(() => events.push('second'))

    controller.abort()
    await Promise.resolve()
    expect(events).toEqual(['first'])
    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['first', 'second'])
  })

  it('does not enter a second body until the first body exits', async () => {
    const mutex = new AsyncMutex()
    const releaseFirst = deferred()
    const firstEntered = deferred()
    const events: string[] = []

    const first = mutex.runExclusive(async () => {
      events.push('first entered')
      firstEntered.resolve()
      await releaseFirst.promise
      events.push('first exited')
    })
    await firstEntered.promise

    const second = mutex.runExclusive(async () => {
      events.push('second entered')
    })
    await Promise.resolve()
    expect(events).toEqual(['first entered'])

    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(['first entered', 'first exited', 'second entered'])
  })

  it('releases the next body when the current body rejects', async () => {
    const mutex = new AsyncMutex()
    const rejectFirst = deferred()
    const firstEntered = deferred()
    const secondEntered = deferred()

    const first = mutex.runExclusive(async () => {
      firstEntered.resolve()
      await rejectFirst.promise
    })
    await firstEntered.promise
    const second = mutex.runExclusive(async () => secondEntered.resolve())

    rejectFirst.reject(new Error('first failed'))
    await expect(first).rejects.toThrow('first failed')
    await secondEntered.promise
    await expect(second).resolves.toBeUndefined()
  })
})
