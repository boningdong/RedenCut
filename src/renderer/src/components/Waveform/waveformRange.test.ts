import { describe, expect, it } from 'vitest'
import { calculateVisibleWaveformRange } from './waveformRange'

const base = {
  outputStart: 10,
  sourceStart: 20,
  sourceEnd: 30,
  pxPerSec: 100,
  viewportStartPx: 0,
  viewportWidthPx: 1_920,
}

describe('calculateVisibleWaveformRange', () => {
  it('maps the visible right portion of a clip to source time', () => {
    expect(calculateVisibleWaveformRange(base)).toEqual({
      leftInClipPx: 0,
      widthPx: 920,
      sourceStartSeconds: 20,
      sourceEndSeconds: 29.2,
    })
  })

  it('maps a left-clipped viewport to the matching source start', () => {
    expect(
      calculateVisibleWaveformRange({ ...base, viewportStartPx: 1_250, viewportWidthPx: 500 }),
    ).toEqual({
      leftInClipPx: 250,
      widthPx: 500,
      sourceStartSeconds: 22.5,
      sourceEndSeconds: 27.5,
    })
  })

  it('returns null outside the viewport or for non-positive inputs', () => {
    expect(
      calculateVisibleWaveformRange({ ...base, viewportStartPx: 2_100, viewportWidthPx: 500 }),
    ).toBeNull()
    expect(calculateVisibleWaveformRange({ ...base, pxPerSec: 0 })).toBeNull()
    expect(calculateVisibleWaveformRange({ ...base, viewportWidthPx: 0 })).toBeNull()
    expect(calculateVisibleWaveformRange({ ...base, sourceEnd: 20 })).toBeNull()
  })
})
