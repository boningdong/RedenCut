import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceToken } from '../../shared/session.types'
import { SessionJobRegistry } from './SessionJobRegistry'

const TOKEN_A = 'token-a' as WorkspaceToken
const TOKEN_B = 'token-b' as WorkspaceToken

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('SessionJobRegistry', () => {
  it('rejects registrations for a closing token until it is reopened', () => {
    const registry = new SessionJobRegistry()
    registry.beginClosing(TOKEN_A)
    const registration = {
      kind: 'import' as const,
      jobId: 'job-1',
      senderId: 1,
      workspaceToken: TOKEN_A,
      cancel: vi.fn(),
      settled: Promise.resolve(),
    }

    expect(() => registry.register(registration)).toThrow('Session is closing')
    registry.reopen(TOKEN_A)
    const unregister = registry.register(registration)
    expect(() => unregister()).not.toThrow()
    expect(() => unregister()).not.toThrow()
  })

  it('rejects duplicate job identities', () => {
    const registry = new SessionJobRegistry()
    const registration = {
      kind: 'export' as const,
      jobId: 'job-1',
      senderId: 7,
      workspaceToken: TOKEN_A,
      cancel: vi.fn(),
      settled: Promise.resolve(),
    }
    registry.register(registration)

    expect(() => registry.register(registration)).toThrow('Job is already registered')
  })

  it('cancels a job once across concurrent calls and awaits settlement', async () => {
    const registry = new SessionJobRegistry()
    const settled = deferred()
    const cancel = vi.fn()
    registry.register({
      kind: 'transcription',
      jobId: 'job-1',
      senderId: 1,
      workspaceToken: TOKEN_A,
      cancel,
      settled: settled.promise,
    })
    const identity = {
      kind: 'transcription' as const,
      jobId: 'job-1',
      senderId: 1,
      workspaceToken: TOKEN_A,
    }

    const first = registry.cancelAndSettleJob(identity)
    const second = registry.cancelAndSettleJob(identity)
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
    let completed = false
    void first.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    settled.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })

  it('awaits every matched job before aggregating settlement failures', async () => {
    const registry = new SessionJobRegistry()
    const first = deferred()
    const second = deferred()
    const firstCancel = vi.fn()
    const secondCancel = vi.fn()
    registry.register({
      kind: 'import',
      jobId: 'first',
      senderId: 1,
      workspaceToken: TOKEN_A,
      cancel: firstCancel,
      settled: first.promise,
    })
    registry.register({
      kind: 'export',
      jobId: 'second',
      senderId: 2,
      workspaceToken: TOKEN_A,
      cancel: secondCancel,
      settled: second.promise,
    })

    const settlement = registry.cancelAndSettleToken(TOKEN_A)
    first.reject(new Error('first failed'))
    await Promise.resolve()
    let completed = false
    void settlement.catch(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    second.resolve()
    await expect(settlement).rejects.toBeInstanceOf(AggregateError)
    expect(firstCancel).toHaveBeenCalledTimes(1)
    expect(secondCancel).toHaveBeenCalledTimes(1)
  })

  it('sender cancellation leaves other senders and tokens untouched', async () => {
    const registry = new SessionJobRegistry()
    const matchingCancel = vi.fn()
    const otherSenderCancel = vi.fn()
    const otherTokenCancel = vi.fn()
    registry.register({
      kind: 'import',
      jobId: 'matching',
      senderId: 1,
      workspaceToken: TOKEN_A,
      cancel: matchingCancel,
      settled: Promise.resolve(),
    })
    registry.register({
      kind: 'transcription',
      jobId: 'other-sender',
      senderId: 2,
      workspaceToken: TOKEN_A,
      cancel: otherSenderCancel,
      settled: Promise.resolve(),
    })
    registry.register({
      kind: 'export',
      jobId: 'other-token',
      senderId: 1,
      workspaceToken: TOKEN_B,
      cancel: otherTokenCancel,
      settled: Promise.resolve(),
    })

    await registry.cancelAndSettleSender(1)

    expect(matchingCancel).toHaveBeenCalledTimes(1)
    expect(otherTokenCancel).toHaveBeenCalledTimes(1)
    expect(otherSenderCancel).not.toHaveBeenCalled()
  })
})
