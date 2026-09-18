// @vitest-environment jsdom
import React, { StrictMode, useRef, useState } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getTimelineContentWidth } from './TimelineViewportGeometry'
import { useTimelineZoom } from './UseTimelineZoom'

function setup(basePxPerSec = 80, duration = 10, audioDuration = duration) {
  let controls: ReturnType<typeof useTimelineZoom>
  function Timeline() {
    const viewportRef = useRef<HTMLDivElement>(null)
    const [visibleStart, setVisibleStart] = useState(0)
    controls = useTimelineZoom({
      viewportRef,
      basePxPerSec,
      duration,
      audioDuration,
      viewportWidth: 800,
      onScrollChange: setVisibleStart,
    })
    return (
      <div ref={viewportRef} data-visible-start={visibleStart}>
        <div
          style={{
            width: getTimelineContentWidth(duration, basePxPerSec * controls.zoomLevel, 800),
          }}
        />
      </div>
    )
  }
  const view = render(
    <StrictMode>
      <Timeline />
    </StrictMode>,
  )
  const viewport = view.container.firstElementChild as HTMLDivElement
  Object.defineProperties(viewport, {
    clientWidth: { value: 800 },
    scrollWidth: {
      get: () =>
        Math.max(800, Number.parseFloat((viewport.firstElementChild as HTMLElement).style.width)),
    },
  })
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 190 } as DOMRect)
  return {
    viewport,
    updateExtent: (nextDuration: number) => {
      duration = nextDuration
      view.rerender(
        <StrictMode>
          <Timeline />
        </StrictMode>,
      )
    },
    zoom: (factor: number, clientX?: number) => controls!.zoomBy(factor, clientX),
    controls: () => controls!,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('anchors toolbar zoom to the viewport center and synchronizes visible waveform bounds', () => {
  const { viewport, zoom } = setup()
  act(() => zoom(2))
  expect(viewport.scrollLeft).toBe(400)
  expect(viewport.dataset.visibleStart).toBe('400')
  act(() => zoom(0.5))
  expect(viewport.scrollLeft).toBe(0)
})

it('accumulates rapid wheel events even when the cursor moves between them', () => {
  const { viewport, zoom } = setup()
  act(() => {
    zoom(2, 390)
    zoom(2, 590)
  })
  expect(viewport.scrollLeft).toBe(800)
})

it('commits a changed anchor even when batched events return to the original scale', () => {
  const { viewport, zoom } = setup()
  act(() => zoom(2))
  act(() => {
    zoom(2, 590)
    zoom(0.5, 390)
  })
  expect(viewport.scrollLeft).toBe(500)
})

it('uses live scroll position when a native scroll has not reached React state', () => {
  const { viewport, zoom } = setup()
  act(() => zoom(2))
  viewport.scrollLeft = 200
  act(() => zoom(2, 490))
  expect(viewport.scrollLeft).toBe(700)
})

it('clamps to the padded right edge when zooming out and to zero near the origin', () => {
  const { viewport, zoom } = setup()
  act(() => zoom(4))
  viewport.scrollLeft = 3200
  act(() => zoom(0.5, 190))
  expect(viewport.scrollLeft).toBe(1600)
  act(() => zoom(0.125, 790))
  expect(viewport.scrollLeft).toBe(0)
})

it('does not scroll when already at a zoom limit', () => {
  const { viewport, zoom, controls } = setup()
  act(() => zoom(100))
  expect(controls().canZoomIn).toBe(false)
  viewport.scrollLeft = 123
  act(() => zoom(2, 590))
  expect(viewport.scrollLeft).toBe(123)
  act(() => zoom(0.00001))
  expect(controls().canZoomOut).toBe(false)
  expect(viewport.scrollLeft).toBe(0)
})

it('keeps the timeline origin fixed through repeated zooms within the left-edge snap zone', () => {
  const { viewport, zoom } = setup()
  for (const clientX of [191, 196, 202]) {
    act(() => zoom(1.2, clientX))
    expect(viewport.scrollLeft).toBe(0)
  }
  act(() => {
    zoom(1.2, 198)
    zoom(1.2, 200)
  })
  expect(viewport.scrollLeft).toBe(0)
  act(() => zoom(1 / 1.2, 196))
  expect(viewport.scrollLeft).toBe(0)
})

it('retains exact pointer anchoring outside the left-edge snap zone', () => {
  const { viewport, zoom } = setup()
  act(() => zoom(2, 203))
  expect(viewport.scrollLeft).toBe(13)
})

it('anchors the visible left edge after panning instead of jumping to time zero', () => {
  const { viewport, zoom } = setup()
  viewport.scrollLeft = 200
  act(() => zoom(2, 196))
  expect(viewport.scrollLeft).toBe(400)
  act(() => zoom(0.5, 196))
  expect(viewport.scrollLeft).toBe(200)
})

it.each([10, 3600, 7200])(
  'allows precise editing independently of duration (%s seconds)',
  (duration) => {
    const scale = 800 / duration
    const { controls, zoom, viewport } = setup(scale, duration)
    act(() => zoom(1e6, 590))
    expect(controls().zoomLevel * scale).toBeCloseTo(1000)
    expect(controls().canZoomIn).toBe(false)
    expect((viewport.scrollLeft + 400) / 1000).toBeCloseTo(duration / 2)
    act(() => zoom(0.5, 590))
    expect(controls().canZoomIn).toBe(true)
    expect((viewport.scrollLeft + 400) / 500).toBeCloseTo(duration / 2)
  },
)

it('keeps day-long audio inside browser layout limits and its end reachable', () => {
  const scale = 800 / 86400
  const { controls, zoom, viewport } = setup(scale, 86400)
  viewport.scrollLeft = 800
  act(() => zoom(1e9, 190))
  expect(viewport.scrollWidth).toBeLessThan(33_000_000)
  expect(viewport.scrollLeft / (scale * controls().zoomLevel)).toBeCloseTo(86400)
})

it.each([3600, 5400])(
  'fits the complete current timeline into 75 percent of the viewport (%s seconds)',
  (duration) => {
    const base = 800 / 3600
    const { controls, zoom, viewport } = setup(base, duration)
    act(() => zoom(8))
    viewport.scrollLeft = 2000
    act(() => zoom(0.00001, 900))
    expect(duration * base * controls().zoomLevel).toBeCloseTo(600)
    expect(viewport.scrollLeft).toBe(0)
    expect(controls().canZoomOut).toBe(false)
    expect(viewport.scrollWidth).toBeCloseTo(1400)
    // Audio tail stays at x=600 when zooming in, with space on its right.
    act(() => zoom(2, 790))
    expect(viewport.scrollLeft).toBeCloseTo(600)
    expect(duration * base * controls().zoomLevel - viewport.scrollLeft).toBeCloseTo(600)
  },
)

it('recalculates overview after edits without changing scale during an extension', () => {
  const { controls, zoom, viewport, updateExtent } = setup()
  act(() => zoom(0.001))
  expect(controls().zoomLevel).toBeCloseTo(0.75)
  updateExtent(20)
  expect(controls().zoomLevel).toBeCloseTo(0.75)
  expect(controls().canZoomOut).toBe(true)
  act(() => zoom(0.001))
  expect(controls().zoomLevel).toBeCloseTo(3 / 7)
  viewport.scrollLeft = 300
  updateExtent(5)
  expect(controls().zoomLevel).toBeCloseTo(1.2)
  expect(viewport.scrollLeft).toBe(0)
  updateExtent(10)
  expect(controls().zoomLevel).toBeCloseTo(1.2)
  expect(controls().canZoomOut).toBe(true)
})

it('keeps a twenty-minute overview tail after repeatedly moving one-hour audio right', () => {
  const base = 800 / 3600
  const { controls, zoom, updateExtent, viewport } = setup(base, 3600)
  for (const end of [3600, 5400, 7200, 10800, 3600]) {
    updateExtent(end)
    act(() => zoom(0.00001))
    const scale = base * controls().zoomLevel
    expect(800 / scale - end).toBeCloseTo(1200)
    expect(controls().canZoomOut).toBe(false)
    const tailX = end * scale
    act(() => zoom(2, 190 + tailX))
    expect(end * base * controls().zoomLevel - viewport.scrollLeft).toBeCloseTo(tailX)
  }
})

it('uses the same fixed tail when reopening audio that has already been moved', () => {
  const base = 800 / 7200
  const { controls, zoom } = setup(base, 7200, 3600)
  act(() => zoom(0.00001))
  expect(800 / (base * controls().zoomLevel)).toBeCloseTo(8400)
})
