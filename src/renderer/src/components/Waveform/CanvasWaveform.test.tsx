// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WaveformBucketRange,
  WaveformDataProvider,
  WaveformRangeRequest,
} from './WaveformDataProvider'
import { CanvasWaveform } from './CanvasWaveform'

const originalCanvasGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'getContext',
)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function recordingContext() {
  return {
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
  }
}

function waveformProps(overrides: Partial<React.ComponentProps<typeof CanvasWaveform>> = {}) {
  return {
    provider: { readRange: vi.fn() } satisfies WaveformDataProvider,
    sourceStartSeconds: 1.25,
    sourceEndSeconds: 4.75,
    leftInClipPx: 12,
    widthPx: 300,
    heightPx: 40,
    color: '#bada55',
    muted: false,
    ...overrides,
  }
}

describe('CanvasWaveform', () => {
  let context: ReturnType<typeof recordingContext>

  beforeEach(() => {
    context = recordingContext()
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => context),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCanvasGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalCanvasGetContext)
    }
  })

  it('centers waveforms in their clip unless an explicit stack offset is provided', () => {
    const props = waveformProps({ provider: { readRange: () => new Promise(() => {}) } })
    const { container, rerender } = render(<CanvasWaveform {...props} />)
    const canvas = container.querySelector('canvas')!
    expect(canvas.style.top).toBe('50%')
    expect(canvas.style.transform).toBe('translateY(-50%)')
    rerender(<CanvasWaveform {...props} topPx={0} />)
    expect(canvas.style.top).toBe('0px')
    expect(canvas.style.transform).toBe('')
  })

  it('requests the visible source interval at the device-pixel backing width and draws its buckets', async () => {
    const response = deferred<WaveformBucketRange>()
    const provider: WaveformDataProvider = {
      readRange: vi.fn(() => response.promise),
    }
    const { container } = render(<CanvasWaveform {...waveformProps({ provider })} />)

    await waitFor(() => expect(provider.readRange).toHaveBeenCalledTimes(1))

    const [request] = vi.mocked(provider.readRange).mock.calls[0] as [WaveformRangeRequest]
    expect(request).toMatchObject({
      sourceStartSeconds: 1.25,
      sourceEndSeconds: 4.75,
      targetPixelWidth: 600,
    })
    expect(request.signal).toBeInstanceOf(AbortSignal)

    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas?.height).toBe(80)
    expect(canvas?.width).toBe(600)
    expect(canvas?.style.height).toBe('40px')
    expect(canvas?.style.left).toBe('12px')
    expect(canvas?.style.position).toBe('absolute')
    expect(canvas?.style.width).toBe('300px')
    expect(canvas?.getAttribute('data-waveform-ready')).toBe('false')

    await act(async () => {
      response.resolve({ buckets: [{ min: -0.75, max: 0.5 }] })
      await Promise.resolve()
    })

    expect(context.fillStyle).toBe('#bada55')
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 600, 80)
    expect(context.fillRect).toHaveBeenCalledWith(298.5, 20, 3, 50)
    expect(canvas?.getAttribute('data-waveform-ready')).toBe('true')
  })

  it('cancels the obsolete interval and never draws its late result', async () => {
    const first = deferred<WaveformBucketRange>()
    const second = deferred<WaveformBucketRange>()
    const signals: AbortSignal[] = []
    const provider: WaveformDataProvider = {
      readRange: vi.fn((request: WaveformRangeRequest) => {
        signals.push(request.signal)
        return signals.length === 1 ? first.promise : second.promise
      }),
    }
    const { rerender, container } = render(<CanvasWaveform {...waveformProps({ provider })} />)

    await waitFor(() => expect(provider.readRange).toHaveBeenCalledTimes(1))
    rerender(
      <CanvasWaveform
        {...waveformProps({ provider, sourceStartSeconds: 8, sourceEndSeconds: 12 })}
      />,
    )
    await waitFor(() => expect(provider.readRange).toHaveBeenCalledTimes(2))

    expect(signals[0]?.aborted).toBe(true)
    await act(async () => {
      first.resolve({ buckets: [{ min: -1, max: -0.5 }] })
      await Promise.resolve()
    })
    expect(context.fillRect).not.toHaveBeenCalled()
    expect(container.querySelector('canvas')?.getAttribute('data-waveform-ready')).toBe('false')

    await act(async () => {
      second.resolve({ buckets: [{ min: -0.25, max: 0.75 }] })
      await Promise.resolve()
    })
    expect(context.fillRect).toHaveBeenCalledWith(298.5, 10, 3, 40)
    expect(container.querySelector('canvas')?.getAttribute('data-waveform-ready')).toBe('true')
  })

  it('does not report a failed waveform request as ready', async () => {
    const provider: WaveformDataProvider = {
      readRange: vi.fn(() => Promise.reject(new Error('cache unavailable'))),
    }
    const { container } = render(<CanvasWaveform {...waveformProps({ provider })} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('canvas')?.getAttribute('data-waveform-ready')).toBe('false')
    expect(context.fillRect).not.toHaveBeenCalled()
  })

  it('dims muted waveforms while preserving the track color', async () => {
    const provider: WaveformDataProvider = {
      readRange: vi.fn(() => Promise.resolve({ buckets: [{ min: -0.5, max: 0.5 }] })),
    }
    const { container } = render(<CanvasWaveform {...waveformProps({ muted: true, provider })} />)

    await waitFor(() => expect(context.fillStyle).toBe('#bada55'))

    expect(container.querySelector('canvas')?.style.opacity).toBe('0.55')
  })
})

it('fits the full-source peak once and preserves scale across scrolling and gain changes', async () => {
  const context = recordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
  const provider: WaveformDataProvider = {
    getPeak: vi.fn(async () => 0.5),
    readRange: vi.fn(async () => ({ buckets: [{ min: -0.25, max: 0.25 }] })),
  }
  const props = waveformProps({ provider, widthPx: 30, heightPx: 100 })
  const { container, rerender } = render(<CanvasWaveform {...props} />)
  await waitFor(() =>
    expect(context.fillRect).toHaveBeenLastCalledWith(14.25, 28.749999999999996, 1.5, 42.5),
  )
  rerender(<CanvasWaveform {...props} sourceStartSeconds={8} sourceEndSeconds={9} gain={2} />)
  await waitFor(() =>
    expect(context.fillRect).toHaveBeenLastCalledWith(14.25, 7.500000000000001, 1.5, 85),
  )
  expect(container.querySelector('canvas')?.dataset.visualOverflow).toBe('false')
  rerender(<CanvasWaveform {...props} gain={3} />)
  await waitFor(() =>
    expect(container.querySelector('canvas')?.dataset.visualOverflow).toBe('true'),
  )
  expect(context.fillRect.mock.calls.every(([, , width]) => width < 30)).toBe(true)
  vi.restoreAllMocks()
})

it('uses a safe unity scale for an entirely silent source', async () => {
  const context = recordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  const provider: WaveformDataProvider = {
    getPeak: async () => 0,
    readRange: async () => ({ buckets: [{ min: 0, max: 0 }] }),
  }
  const { container } = render(<CanvasWaveform {...waveformProps({ provider })} />)
  await waitFor(() => expect(container.querySelector('canvas')?.dataset.waveformReady).toBe('true'))
  expect(container.querySelector('canvas')?.dataset.visualOverflow).toBe('false')
  expect(context.fillRect.mock.calls.flat().every(Number.isFinite)).toBe(true)
  vi.restoreAllMocks()
})

it('redraws gain, visual scale, height and color changes without rereading source buckets', async () => {
  const context = recordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
  const provider: WaveformDataProvider = {
    getPeak: vi.fn(async () => 0.5),
    readRange: vi.fn(async () => ({ buckets: [{ min: -0.25, max: 0.25 }] })),
  }
  const props = waveformProps({ provider, widthPx: 30, heightPx: 100 })
  const { rerender } = render(<CanvasWaveform {...props} />)
  await waitFor(() => expect(context.fillRect).toHaveBeenCalled())
  const originalHeight = context.fillRect.mock.lastCall![3]
  rerender(<CanvasWaveform {...props} gain={2} />)
  await waitFor(() => expect(context.fillRect.mock.lastCall![3]).toBeCloseTo(originalHeight * 2))
  rerender(<CanvasWaveform {...props} gain={2} amplitudeScale={1} heightPx={80} color="#123456" />)
  await waitFor(() => expect(context.fillRect).toHaveBeenLastCalledWith(14.25, 20, 1.5, 40))
  expect(context.fillStyle).toBe('#123456')
  expect(provider.readRange).toHaveBeenCalledTimes(1)
  expect(provider.getPeak).toHaveBeenCalledTimes(1)
  vi.restoreAllMocks()
})

it('does not amplify near-silent original sources', async () => {
  const context = recordingContext()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })
  const provider: WaveformDataProvider = {
    getPeak: async () => 1e-12,
    readRange: async () => ({ buckets: [{ min: -1e-12, max: 1e-12 }] }),
  }
  render(<CanvasWaveform {...waveformProps({ provider, widthPx: 30, heightPx: 100 })} />)
  await waitFor(() => expect(context.fillRect).toHaveBeenCalled())
  expect(context.fillRect.mock.lastCall![3]).toBe(1)
  vi.restoreAllMocks()
})
