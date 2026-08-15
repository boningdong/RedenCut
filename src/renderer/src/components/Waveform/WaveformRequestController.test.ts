import { describe, expect, it, vi } from 'vitest'
import type { WaveformDataProvider, WaveformRangeRequest } from './WaveformDataProvider'
import { WaveformRequestController } from './WaveformRequestController'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('WaveformRequestController', () => {
  it('aborts and ignores an obsolete request while committing the latest result', async () => {
    const first = deferred<{ buckets: [] }>()
    const second = deferred<{ buckets: [] }>()
    const signals: AbortSignal[] = []
    const provider: WaveformDataProvider = {
      readRange: vi.fn((request: WaveformRangeRequest) => {
        signals.push(request.signal)
        return signals.length === 1 ? first.promise : second.promise
      }),
    }
    const commit = vi.fn()
    const controller = new WaveformRequestController()

    const firstRun = controller.request(provider, 0, 10, 100, commit)
    const secondRun = controller.request(provider, 10, 20, 100, commit)

    expect(signals[0].aborted).toBe(true)
    first.resolve({ buckets: [] })
    second.resolve({ buckets: [] })
    await Promise.all([firstRun, secondRun])

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ buckets: [] })
  })

  it('does not report a late rejection from an obsolete request', async () => {
    const first = deferred<{ buckets: [] }>()
    const second = deferred<{ buckets: [] }>()
    const provider: WaveformDataProvider = {
      readRange: vi.fn((request: WaveformRangeRequest) =>
        request.sourceStartSeconds === 0 ? first.promise : second.promise,
      ),
    }
    const reportError = vi.fn()
    const controller = new WaveformRequestController()

    const firstRun = controller.request(provider, 0, 10, 100, vi.fn(), reportError)
    const secondRun = controller.request(provider, 10, 20, 100, vi.fn(), reportError)

    first.reject(new Error('obsolete request failed'))
    second.resolve({ buckets: [] })
    await Promise.all([firstRun, secondRun])

    expect(reportError).not.toHaveBeenCalled()
  })

  it('aborts the active request when cancelled', () => {
    let signal: AbortSignal | undefined
    const provider: WaveformDataProvider = {
      readRange: vi.fn((request: WaveformRangeRequest) => {
        signal = request.signal
        return new Promise<{ buckets: [] }>(() => undefined)
      }),
    }
    const controller = new WaveformRequestController()

    void controller.request(provider, 0, 1, 1, vi.fn())
    controller.cancel()

    expect(signal?.aborted).toBe(true)
  })
})
