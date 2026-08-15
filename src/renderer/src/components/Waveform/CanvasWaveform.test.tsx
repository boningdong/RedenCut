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

    await act(async () => {
      response.resolve({ buckets: [{ min: -0.75, max: 0.5 }] })
      await Promise.resolve()
    })

    expect(context.fillStyle).toBe('#bada55')
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 600, 80)
    expect(context.fillRect).toHaveBeenCalledWith(0, 20, 600, 50)
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
    const { rerender } = render(<CanvasWaveform {...waveformProps({ provider })} />)

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

    await act(async () => {
      second.resolve({ buckets: [{ min: -0.25, max: 0.75 }] })
      await Promise.resolve()
    })
    expect(context.fillRect).toHaveBeenCalledWith(0, 10, 600, 40)
  })

  it('uses the computed muted waveform color', async () => {
    const provider: WaveformDataProvider = {
      readRange: vi.fn(() => Promise.resolve({ buckets: [{ min: -0.5, max: 0.5 }] })),
    }
    const mutedColor = 'rgb(99, 88, 77)'
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: vi.fn((name: string) =>
        name === '--waveform-color-muted' ? mutedColor : '',
      ),
    } as unknown as CSSStyleDeclaration)
    const { container } = render(<CanvasWaveform {...waveformProps({ muted: true, provider })} />)

    await waitFor(() => expect(context.fillStyle).toBe(mutedColor))

    expect(getComputedStyle).toHaveBeenCalledWith(container.querySelector('canvas'))
  })
})
