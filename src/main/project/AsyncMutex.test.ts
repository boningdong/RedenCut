import { describe, expect, it } from 'vitest'
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
