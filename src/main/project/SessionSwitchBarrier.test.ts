import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceToken } from '../../shared/session.types'
import { SessionSwitchBarrier } from './SessionSwitchBarrier'

const SESSION = { workspaceToken: 'workspace-a' as WorkspaceToken, revision: 4 }

function sender(id = 7) {
  const destroyed = new Set<() => void>()
  let isDestroyed = false
  return {
    id,
    send: vi.fn(),
    isDestroyed: vi.fn(() => isDestroyed),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.add(listener)
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.delete(listener)
    }),
    destroy: () => {
      isDestroyed = true
      ;[...destroyed].forEach((listener) => listener())
    },
  }
}

describe('SessionSwitchBarrier', () => {
  it('accepts only the exact sender, session, and one-use transition identifier', async () => {
    const barrier = new SessionSwitchBarrier({ createId: () => 'opaque-transition' })
    const owner = sender()
    const waiting = barrier.wait(owner, SESSION)
    expect(owner.send).toHaveBeenCalledWith('project:will-switch', {
      transitionId: 'opaque-transition',
      ...SESSION,
    })

    expect(barrier.acknowledge(8, { transitionId: 'opaque-transition', ...SESSION })).toBe(false)
    expect(
      barrier.acknowledge(7, { transitionId: 'opaque-transition', ...SESSION, revision: 5 }),
    ).toBe(false)
    expect(barrier.acknowledge(7, { transitionId: 'opaque-transition', ...SESSION })).toBe(true)
    expect(barrier.acknowledge(7, { transitionId: 'opaque-transition', ...SESSION })).toBe(false)
    await expect(waiting).resolves.toBeUndefined()
  })

  it('rejects at exactly five seconds and immediately on sender destruction', async () => {
    vi.useFakeTimers()
    try {
      const barrier = new SessionSwitchBarrier({ createId: () => 'first-transition' })
      const timed = barrier.wait(sender(), SESSION)
      await vi.advanceTimersByTimeAsync(4_999)
      let settled = false
      void timed.catch(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(timed).rejects.toThrow('Project switch was not acknowledged')

      const lostSender = sender()
      const lost = barrier.wait(lostSender, SESSION)
      lostSender.destroy()
      await expect(lost).rejects.toThrow('Project switch sender was destroyed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleans up immediately when sending the switch request fails', async () => {
    const barrier = new SessionSwitchBarrier({ createId: () => 'opaque-transition' })
    const lostSender = sender()
    lostSender.send.mockImplementationOnce(() => {
      throw new Error('send failed')
    })

    await expect(barrier.wait(lostSender, SESSION)).rejects.toThrow('send failed')
    expect(lostSender.removeListener).toHaveBeenCalledTimes(1)
    expect(barrier.acknowledge(7, { transitionId: 'opaque-transition', ...SESSION })).toBe(false)
  })

  it('rejects pending barriers during application shutdown without waiting for timeout', async () => {
    const barrier = new SessionSwitchBarrier({ createId: () => 'opaque-transition' })
    const waiting = barrier.wait(sender(), SESSION)

    barrier.shutdown()

    await expect(waiting).rejects.toMatchObject({ name: 'ProjectSwitchShutdownError' })
    await expect(barrier.wait(sender(), SESSION)).rejects.toMatchObject({
      name: 'ProjectSwitchShutdownError',
    })
  })
})
