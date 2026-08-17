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
    const identity = {
      kind: 'import' as const,
      jobId: 'job-1',
      senderId: 1,
      workspaceToken: TOKEN_A,
      revision: 1,
    }
    const start = vi.fn(() => ({ cancel: vi.fn(), settled: Promise.resolve() }))

    expect(() => registry.register(identity, start)).toThrow('Session is closing')
    expect(start).not.toHaveBeenCalled()
    registry.reopen(TOKEN_A)
    const unregister = registry.register(identity, start)
    expect(start).toHaveBeenCalledTimes(1)
    expect(() => unregister()).not.toThrow()
    expect(() => unregister()).not.toThrow()
  })

  it('rejects duplicate job identities', () => {
    const registry = new SessionJobRegistry()
    const identity = {
      kind: 'export' as const,
      jobId: 'job-1',
      senderId: 7,
      workspaceToken: TOKEN_A,
      revision: 1,
    }
    registry.register(identity, () => ({ cancel: vi.fn(), settled: Promise.resolve() }))
    const duplicateStart = vi.fn(() => ({ cancel: vi.fn(), settled: Promise.resolve() }))

    expect(() => registry.register(identity, duplicateStart)).toThrow('Job is already registered')
    expect(duplicateStart).not.toHaveBeenCalled()
  })

  it('distinguishes exact jobs by starting revision while token settlement spans revisions', async () => {
    const registry = new SessionJobRegistry()
    const revisionOneCancel = vi.fn()
    const revisionTwoCancel = vi.fn()
    const common = {
      kind: 'transcription' as const,
      jobId: 'shared-job',
      senderId: 7,
      workspaceToken: TOKEN_A,
    }
    registry.register({ ...common, revision: 1 }, () => ({
      cancel: revisionOneCancel,
      settled: Promise.resolve(),
    }))
    registry.register({ ...common, revision: 2 }, () => ({
      cancel: revisionTwoCancel,
      settled: Promise.resolve(),
    }))

    await expect(registry.cancelAndSettleJob({ ...common, revision: 3 })).resolves.toBe(false)
    expect(revisionOneCancel).not.toHaveBeenCalled()
    expect(revisionTwoCancel).not.toHaveBeenCalled()

    await expect(registry.cancelAndSettleJob({ ...common, revision: 1 })).resolves.toBe(true)
    expect(revisionOneCancel).toHaveBeenCalledTimes(1)
    expect(revisionTwoCancel).not.toHaveBeenCalled()

    await registry.cancelAndSettleToken(TOKEN_A)
    expect(revisionTwoCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels a job once across concurrent calls and awaits settlement', async () => {
    const registry = new SessionJobRegistry()
    const settled = deferred()
    const cancel = vi.fn()
    const identity = {
      kind: 'transcription' as const,
      jobId: 'job-1',
      senderId: 1,
      workspaceToken: TOKEN_A,
      revision: 1,
    }
    registry.register(identity, () => ({ cancel, settled: settled.promise }))

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

  it('treats an AbortError settlement as successful cancellation', async () => {
    const registry = new SessionJobRegistry()
    const settled = deferred()
    const identity = {
      kind: 'import' as const,
      jobId: 'job-1',
      senderId: 1,
      workspaceToken: TOKEN_A,
      revision: 1,
    }
    registry.register(identity, () => ({ cancel: vi.fn(), settled: settled.promise }))

    const cancellation = registry.cancelAndSettleJob(identity)
    settled.reject(new DOMException('cancelled', 'AbortError'))

    await expect(cancellation).resolves.toBe(true)
  })

  it('awaits every matched job before aggregating settlement failures', async () => {
    const registry = new SessionJobRegistry()
    const first = deferred()
    const second = deferred()
    const firstCancel = vi.fn()
    const secondCancel = vi.fn()
    registry.register(
      { kind: 'import', jobId: 'first', senderId: 1, workspaceToken: TOKEN_A, revision: 1 },
      () => ({ cancel: firstCancel, settled: first.promise }),
    )
    registry.register(
      { kind: 'export', jobId: 'second', senderId: 2, workspaceToken: TOKEN_A, revision: 2 },
      () => ({ cancel: secondCancel, settled: second.promise }),
    )

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
    registry.register(
      { kind: 'import', jobId: 'matching', senderId: 1, workspaceToken: TOKEN_A, revision: 1 },
      () => ({ cancel: matchingCancel, settled: Promise.resolve() }),
    )
    registry.register(
      {
        kind: 'transcription',
        jobId: 'other-sender',
        senderId: 2,
        workspaceToken: TOKEN_A,
        revision: 1,
      },
      () => ({ cancel: otherSenderCancel, settled: Promise.resolve() }),
    )
    registry.register(
      {
        kind: 'export',
        jobId: 'other-token',
        senderId: 1,
        workspaceToken: TOKEN_B,
        revision: 1,
      },
      () => ({ cancel: otherTokenCancel, settled: Promise.resolve() }),
    )

    await registry.cancelAndSettleSender(1)

    expect(matchingCancel).toHaveBeenCalledTimes(1)
    expect(otherTokenCancel).toHaveBeenCalledTimes(1)
    expect(otherSenderCancel).not.toHaveBeenCalled()
  })
})
