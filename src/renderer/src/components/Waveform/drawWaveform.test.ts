import { describe, expect, it } from 'vitest'
import type { WaveformBucket } from './WaveformDataProvider'
import { drawWaveform, type WaveformDrawingContext } from './drawWaveform'

interface FillRectCall {
  x: number
  y: number
  width: number
  height: number
}

function recordingContext() {
  const clearRectCalls: FillRectCall[] = []
  const fillRectCalls: FillRectCall[] = []
  const context: WaveformDrawingContext = {
    fillStyle: '',
    clearRect: (x, y, width, height) => clearRectCalls.push({ x, y, width, height }),
    fillRect: (x, y, width, height) => fillRectCalls.push({ x, y, width, height }),
  }
  return { context, clearRectCalls, fillRectCalls }
}

describe('drawWaveform', () => {
  it('draws one bounded waveform primitive for each bucket', () => {
    const { context, clearRectCalls, fillRectCalls } = recordingContext()
    const buckets: WaveformBucket[] = [
      { min: -1, max: 0.5 },
      { min: -0.25, max: 0.25 },
      { min: -0.75, max: 1 },
    ]

    drawWaveform(context, buckets, 30, 80, '#abc')

    expect(context.fillStyle).toBe('#abc')
    expect(clearRectCalls).toEqual([{ x: 0, y: 0, width: 30, height: 80 }])
    expect(fillRectCalls).toHaveLength(3)
    expect(fillRectCalls).toEqual([
      { x: 4.25, y: 20, width: 1.5, height: 60 },
      { x: 14.25, y: 30, width: 1.5, height: 20 },
      { x: 24.25, y: 0, width: 1.5, height: 70 },
    ])
  })

  it('maps amplitudes to the canvas coordinate system', () => {
    const { context, fillRectCalls } = recordingContext()

    drawWaveform(context, [{ min: -0.5, max: 0.25 }], 40, 80, '#abc')

    expect(fillRectCalls).toEqual([{ x: 19.25, y: 30, width: 1.5, height: 30 }])
  })

  it('clamps out-of-range and non-finite amplitudes to bounded coordinates', () => {
    const { context, fillRectCalls } = recordingContext()

    drawWaveform(
      context,
      [
        { min: -10, max: 10 },
        { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY },
        { min: Number.NaN, max: Number.NaN },
      ],
      30,
      80,
      '#abc',
    )

    expect(fillRectCalls).toEqual([
      { x: 4.25, y: 0, width: 1.5, height: 80 },
      { x: 14.25, y: 40, width: 1.5, height: 1 },
      { x: 24.25, y: 40, width: 1.5, height: 1 },
    ])
    expect(fillRectCalls.every(({ y, height }) => y >= 0 && y + height <= 80)).toBe(true)
  })
})

it('aggregates dense buckets without losing short peaks and scales spacing for retina', () => {
  const { context, fillRectCalls } = recordingContext()
  const buckets = Array.from({ length: 100 }, () => ({ min: -0.1, max: 0.1 }))
  buckets[7] = { min: -1, max: 1 }
  drawWaveform(context, buckets, 60, 40, '#abc', 2)
  expect(fillRectCalls).toHaveLength(10)
  expect(fillRectCalls[0]).toEqual({ x: 1.5, y: 0, width: 3, height: 40 })
  expect(fillRectCalls.every((bar) => bar.width === 3 && bar.x + bar.width <= 60)).toBe(true)
})

it('uses rounded bars when a browser drawing context supports paths', () => {
  const { context, fillRectCalls } = recordingContext()
  const rounded: number[][] = []
  let filled = 0
  Object.assign(context, {
    beginPath: () => undefined,
    roundRect: (...args: number[]) => rounded.push(args),
    fill: () => filled++,
  })
  drawWaveform(context, [{ min: -1, max: 1 }], 6, 20, '#abc')
  expect(rounded).toEqual([[2.25, 0, 1.5, 20, 0.75]])
  expect(filled).toBe(1)
  expect(fillRectCalls).toHaveLength(0)
})
