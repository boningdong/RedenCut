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
      { x: 0, y: 20, width: 10, height: 60 },
      { x: 10, y: 30, width: 10, height: 20 },
      { x: 20, y: 0, width: 10, height: 70 },
    ])
  })

  it('maps amplitudes to the canvas coordinate system', () => {
    const { context, fillRectCalls } = recordingContext()

    drawWaveform(context, [{ min: -0.5, max: 0.25 }], 40, 80, '#abc')

    expect(fillRectCalls).toEqual([{ x: 0, y: 30, width: 40, height: 30 }])
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
      { x: 0, y: 0, width: 10, height: 80 },
      { x: 10, y: 40, width: 10, height: 1 },
      { x: 20, y: 40, width: 10, height: 1 },
    ])
    expect(fillRectCalls.every(({ y, height }) => y >= 0 && y + height <= 80)).toBe(true)
  })
})
