// @vitest-environment jsdom
import React, { StrictMode, useRef, useState } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getTimelineContentWidth } from './TimelineViewportGeometry'
import { useTimelineZoom } from './UseTimelineZoom'

function setup() {
  let controls: ReturnType<typeof useTimelineZoom>
  function Timeline() {
    const viewportRef = useRef<HTMLDivElement>(null)
    const [visibleStart, setVisibleStart] = useState(0)
    controls = useTimelineZoom({
      viewportRef,
      basePxPerSec: 80,
      duration: 10,
      onScrollChange: setVisibleStart,
    })
    return (
      <div ref={viewportRef} data-visible-start={visibleStart}>
        <div style={{ width: getTimelineContentWidth(10, 80 * controls.zoomLevel, 800) }} />
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
