import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { probeAudio } from './probeAudio'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
}

describe('probeAudio cancellation', () => {
  it('does not spawn FFprobe for an already-aborted signal', async () => {
    const controller = new AbortController()
    const spawn = vi.fn()
    controller.abort()

    await expect(probeAudio('/source.wav', controller.signal, { spawn })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('kills once and awaits close before rejecting an in-flight abort', async () => {
    const controller = new AbortController()
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const probing = probeAudio('/source.wav', controller.signal, { spawn })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))

    controller.abort()
    expect(child.kill).toHaveBeenCalledTimes(1)
    let settled = false
    void probing.catch(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    child.stdout.end()
    child.stderr.end()
    child.emit('close', null, 'SIGKILL')
    await expect(probing).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })
})
