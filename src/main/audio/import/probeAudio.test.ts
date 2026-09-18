import { configureAppRuntime, AppRuntimeLocator } from '../../runtime/AppRuntimeLocator'
import { toIpcResult } from '../../ipc/ipcResult'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeAudio } from './probeAudio'

afterEach(() => vi.unstubAllEnvs())

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
    vi.stubEnv('DYLD_INSERT_LIBRARIES', '/external/library.dylib')
    const controller = new AbortController()
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const probing = probeAudio('/source.wav', controller.signal, { spawn })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.not.objectContaining({ DYLD_INSERT_LIBRARIES: '/external/library.dylib' }),
      }),
    )

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

it('preserves actionable managed-runtime errors at the probe boundary', async () => {
  configureAppRuntime(
    new AppRuntimeLocator({
      packaged: true,
      resourcesPath: '/missing-probe-test-runtime',
      appPath: '',
    }),
  )
  const result = await toIpcResult(
    () => probeAudio('/source.wav'),
    () => {},
  )
  expect(result).toMatchObject({ ok: false, error: { reason: 'runtime-unavailable' } })
  configureAppRuntime(
    new AppRuntimeLocator({ packaged: false, resourcesPath: '', appPath: process.cwd() }),
  )
})
