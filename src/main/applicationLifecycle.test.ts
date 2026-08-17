import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { startApplicationLifecycle } from './applicationLifecycle'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

class FakeApp extends EventEmitter {
  requestSingleInstanceLock = vi.fn(() => true)
  quit = vi.fn()
  ready = deferred<void>()
  whenReady = vi.fn(() => this.ready.promise)
}

function runtime() {
  let minimized = true
  return {
    isWindowDestroyed: vi.fn(() => false),
    isWindowMinimized: vi.fn(() => minimized),
    restoreWindow: vi.fn(() => {
      minimized = false
    }),
    focusWindow: vi.fn(),
    forwardProject: vi.fn(),
    shutdown: vi.fn(),
  }
}

describe('application lifecycle', () => {
  it('quits a losing instance immediately without readiness or initialization', () => {
    const app = new FakeApp()
    app.requestSingleInstanceLock.mockReturnValue(false)
    const initialize = vi.fn()
    const preparePrimary = vi.fn()

    expect(startApplicationLifecycle({ app, preparePrimary, initialize })).toBe(false)

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.whenReady).not.toHaveBeenCalled()
    expect(initialize).not.toHaveBeenCalled()
    expect(preparePrimary).not.toHaveBeenCalled()
  })

  it('queues early second-instance and macOS opens, ignores non-project args, then restores and focuses', async () => {
    const app = new FakeApp()
    const active = runtime()
    const initialize = vi.fn(async () => active)
    startApplicationLifecycle({ app, initialize })

    app.emit('second-instance', {}, ['/Applications/PodCut', '--flag', '/private/Episode.podcut'])
    const preventDefault = vi.fn()
    app.emit('open-file', { preventDefault }, '/private/Mac.podcut')
    app.emit('second-instance', {}, ['/private/not-a-project.txt'])
    expect(initialize).not.toHaveBeenCalled()

    app.ready.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(2))
    expect(active.forwardProject.mock.calls.map(([path]) => path)).toEqual([
      '/private/Episode.podcut',
      '/private/Mac.podcut',
    ])
    expect(active.restoreWindow).toHaveBeenCalledTimes(1)
    expect(active.focusWindow).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('forwards later requests, skips destroyed windows, and shuts down barriers', async () => {
    const app = new FakeApp()
    const active = runtime()
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    await vi.waitFor(() => expect(app.whenReady).toHaveBeenCalled())

    app.emit('second-instance', {}, ['/private/Later.podcut'])
    await vi.waitFor(() =>
      expect(active.forwardProject).toHaveBeenCalledWith('/private/Later.podcut'),
    )
    active.isWindowDestroyed.mockReturnValue(true)
    app.emit('second-instance', {}, ['/private/Ignored.podcut'])
    expect(active.forwardProject).toHaveBeenCalledTimes(1)

    app.emit('before-quit')
    expect(active.shutdown).toHaveBeenCalledTimes(1)
  })
})
