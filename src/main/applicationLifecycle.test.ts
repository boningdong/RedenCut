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

    app.emit('second-instance', {}, [
      '/Applications/RedenCut',
      '--flag',
      '/private/Episode.redencut',
    ])
    const preventDefault = vi.fn()
    app.emit('open-file', { preventDefault }, '/private/Mac.redencut')
    app.emit('second-instance', {}, ['/private/not-a-project.txt'])
    expect(initialize).not.toHaveBeenCalled()

    app.ready.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(2))
    expect(active.forwardProject.mock.calls.map(([path]) => path)).toEqual([
      '/private/Episode.redencut',
      '/private/Mac.redencut',
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

    app.emit('second-instance', {}, ['/private/Later.redencut'])
    await vi.waitFor(() =>
      expect(active.forwardProject).toHaveBeenCalledWith('/private/Later.redencut'),
    )
    active.isWindowDestroyed.mockReturnValue(true)
    active.ensureWindow.mockImplementationOnce(async () => {
      active.isWindowDestroyed.mockReturnValue(false)
    })
    app.emit('second-instance', {}, ['/private/Ignored.redencut'])
    await vi.waitFor(() =>
      expect(active.forwardProject).toHaveBeenCalledWith('/private/Ignored.redencut'),
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

    app.emit('second-instance', {}, ['/private/First.redencut'])
    app.emit('second-instance', {}, ['/private/Second.redencut'])
    await vi.waitFor(() => expect(active.ensureWindow).toHaveBeenCalledTimes(1))
    expect(active.forwardProject).not.toHaveBeenCalled()

    recreated.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(2))
    expect(active.forwardProject.mock.calls.map(([path]) => path)).toEqual([
      '/private/First.redencut',
      '/private/Second.redencut',
    ])
  })

  it('bounds main-only early requests and reports overflow without exposing a path', async () => {
    const app = new FakeApp()
    const active = runtime()
    const reportDiagnostic = vi.fn()
    startApplicationLifecycle({ app, initialize: async () => active, reportDiagnostic })

    for (let index = 0; index < 33; index += 1)
      app.emit('second-instance', {}, [`/private/Queued-${index}.redencut`])
    expect(reportDiagnostic).toHaveBeenCalledTimes(1)
    expect(String(reportDiagnostic.mock.calls[0][0])).not.toContain('/private')

    app.ready.resolve()
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledTimes(32))
    expect(active.forwardProject.mock.calls.at(0)?.[0]).toBe('/private/Queued-0.redencut')
    expect(active.forwardProject.mock.calls.at(-1)?.[0]).toBe('/private/Queued-31.redencut')
  })

  it('drops only its bounded main queue on shutdown while recreation is pending', async () => {
    const app = new FakeApp()
    const active = runtime()
    const recreated = deferred<void>()
    active.ensureWindow.mockReturnValue(recreated.promise)
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    app.emit('second-instance', {}, ['/private/Shutdown.redencut'])
    await vi.waitFor(() => expect(active.ensureWindow).toHaveBeenCalledTimes(1))

    app.emit('before-quit')
    recreated.resolve()
    await Promise.resolve()

    expect(active.shutdown).toHaveBeenCalledTimes(1)
    expect(active.forwardProject).not.toHaveBeenCalled()
  })
  it('waits for asynchronous transfer shutdown and deduplicates repeated quit events', async () => {
    const app = new FakeApp()
    const active = runtime()
    const stopped = deferred<void>()
    active.shutdown.mockReturnValue(stopped.promise)
    const initialize = vi.fn(async () => active)
    startApplicationLifecycle({ app, initialize })
    app.ready.resolve()
    await vi.waitFor(() => expect(initialize).toHaveBeenCalledOnce())
    await Promise.resolve()
    const preventDefault = vi.fn()
    app.emit('before-quit', { preventDefault })
    app.emit('before-quit', { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(active.shutdown).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
    app.emit('second-instance', {}, ['/private/Ignored.redencut'])
    expect(active.forwardProject).not.toHaveBeenCalled()
    stopped.resolve()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    app.emit('before-quit', { preventDefault })
    expect(active.shutdown).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  it('reports async shutdown failure and still completes quit without retrying cleanup', async () => {
    const app = new FakeApp()
    const active = runtime()
    const failure = new Error('shutdown failed')
    active.shutdown.mockImplementation(async () => {
      throw failure
    })
    const initialize = vi.fn(async () => active)
    const reportDiagnostic = vi.fn()
    startApplicationLifecycle({ app, initialize, reportDiagnostic })
    app.ready.resolve()
    await vi.waitFor(() => expect(initialize).toHaveBeenCalledOnce())
    await Promise.resolve()
    const preventDefault = vi.fn()
    app.emit('before-quit', { preventDefault })
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(reportDiagnostic).toHaveBeenCalledWith(failure)
    app.emit('before-quit', { preventDefault })
    expect(active.shutdown).toHaveBeenCalledOnce()
  })
})

describe('quit protection', () => {
  it('waits for the save decision before shutdown, coalesces quit, and leaves the app alive on cancel', async () => {
    const app = new FakeApp()
    const decision = deferred<boolean>()
    const active = { ...runtime(), canShutdown: vi.fn(() => decision.promise) }
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    app.emit('before-quit', event)
    expect(active.canShutdown).toHaveBeenCalledTimes(1)
    expect(active.shutdown).not.toHaveBeenCalled()
    decision.resolve(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(active.shutdown).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    app.emit('second-instance', {}, ['/tmp/Next.redencut'])
    await vi.waitFor(() => expect(active.forwardProject).toHaveBeenCalledWith('/tmp/Next.redencut'))
  })
  it('shuts down only after the renderer confirms departure', async () => {
    const app = new FakeApp()
    const active = { ...runtime(), canShutdown: vi.fn(async () => true) }
    startApplicationLifecycle({ app, initialize: async () => active })
    app.ready.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    app.emit('before-quit', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1))
    expect(active.canShutdown).toHaveBeenCalledTimes(1)
    expect(active.shutdown).toHaveBeenCalledTimes(1)
  })
})

it.each(['throw', 'reject'])('finishes an approved quit after a shutdown %s', async (mode) => {
  const app = new FakeApp()
  const failure = new Error('cleanup failed')
  const active = { ...runtime(), canShutdown: vi.fn(async () => true) }
  active.shutdown.mockImplementation(() => {
    if (mode === 'throw') throw failure
    return Promise.reject(failure)
  })
  const reportDiagnostic = vi.fn()
  startApplicationLifecycle({ app, initialize: async () => active, reportDiagnostic })
  app.ready.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  app.emit('before-quit', { preventDefault: vi.fn() })
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1))
  expect(reportDiagnostic).toHaveBeenCalledWith(failure)
})
