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
    ensureWindow: vi.fn(async () => {}),
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

    app.emit('second-instance', {}, ['/Applications/RiffCut', '--flag', '/private/Episode.riffcut'])
    const preventDefault = vi.fn()
    app.emit('open-file', { preventDefault }, '/private/Mac.riffcut')
    app.emit('second-instance', {}, ['/private/not-a-project.txt'])
    expect(initialize).not.toHaveBeenCalled()

    app.ready.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(2))
    expect(active.forwardProject.mock.calls.map(([path]) => path)).toEqual([
      '/private/Episode.riffcut',
      '/private/Mac.riffcut',
    ])
    expect(active.restoreWindow).toHaveBeenCalledTimes(1)
    expect(active.focusWindow).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('recreates a destroyed macOS window before forwarding and shuts down barriers', async () => {
    const app = new FakeApp()
    const active = runtime()
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    await vi.waitFor(() => expect(app.whenReady).toHaveBeenCalled())

    app.emit('second-instance', {}, ['/private/Later.riffcut'])
    await vi.waitFor(() =>
      expect(active.forwardProject).toHaveBeenCalledWith('/private/Later.riffcut'),
    )
    active.isWindowDestroyed.mockReturnValue(true)
    active.ensureWindow.mockImplementationOnce(async () => {
      active.isWindowDestroyed.mockReturnValue(false)
    })
    app.emit('second-instance', {}, ['/private/Ignored.riffcut'])
    await vi.waitFor(() =>
      expect(active.forwardProject).toHaveBeenCalledWith('/private/Ignored.riffcut'),
    )
    expect(active.ensureWindow).toHaveBeenCalledTimes(2)

    app.emit('before-quit')
    expect(active.shutdown).toHaveBeenCalledTimes(1)
  })

  it('keeps destroyed-window requests FIFO until recreation has finished', async () => {
    const app = new FakeApp()
    const active = runtime()
    const recreated = deferred<void>()
    active.isWindowDestroyed.mockReturnValue(true)
    active.ensureWindow.mockImplementation(async () => {
      await recreated.promise
      active.isWindowDestroyed.mockReturnValue(false)
    })
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    await vi.waitFor(() => expect(active.ensureWindow).toHaveBeenCalledTimes(0))

    app.emit('second-instance', {}, ['/private/First.riffcut'])
    app.emit('second-instance', {}, ['/private/Second.riffcut'])
    await vi.waitFor(() => expect(active.ensureWindow).toHaveBeenCalledTimes(1))
    expect(active.forwardProject).not.toHaveBeenCalled()

    recreated.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(2))
    expect(active.forwardProject.mock.calls.map(([path]) => path)).toEqual([
      '/private/First.riffcut',
      '/private/Second.riffcut',
    ])
  })

  it('bounds main-only early requests and reports overflow without exposing a path', async () => {
    const app = new FakeApp()
    const active = runtime()
    const reportDiagnostic = vi.fn()
    startApplicationLifecycle({ app, initialize: async () => active, reportDiagnostic })

    for (let index = 0; index < 33; index += 1)
      app.emit('second-instance', {}, [`/private/Queued-${index}.riffcut`])
    expect(reportDiagnostic).toHaveBeenCalledTimes(1)
    expect(String(reportDiagnostic.mock.calls[0][0])).not.toContain('/private')

    app.ready.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(32))
    expect(active.forwardProject.mock.calls.at(0)?.[0]).toBe('/private/Queued-0.riffcut')
    expect(active.forwardProject.mock.calls.at(-1)?.[0]).toBe('/private/Queued-31.riffcut')
  })

  it('drops only its bounded main queue on shutdown while recreation is pending', async () => {
    const app = new FakeApp()
    const active = runtime()
    const recreated = deferred<void>()
    active.ensureWindow.mockReturnValue(recreated.promise)
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    app.emit('second-instance', {}, ['/private/Shutdown.riffcut'])
    await vi.waitFor(() => expect(active.ensureWindow).toHaveBeenCalledTimes(1))

    app.emit('before-quit')
    recreated.resolve()
    await Promise.resolve()

    expect(active.shutdown).toHaveBeenCalledTimes(1)
    expect(active.forwardProject).not.toHaveBeenCalled()
  })
})
