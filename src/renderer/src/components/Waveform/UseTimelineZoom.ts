import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { getTimelineContentWidth } from './TimelineViewportGeometry'

const MIN_ZOOM = 1 / 32
const MAX_ZOOM = 32
const LEFT_EDGE_SNAP_PX = 12

interface ZoomAnchor {
  timeSeconds: number
  viewportX: number
}

interface TimelineZoomOptions {
  viewportRef: RefObject<HTMLDivElement | null>
  basePxPerSec: number
  duration: number
  onScrollChange(scrollLeft: number): void
}

export function useTimelineZoom({
  viewportRef,
  basePxPerSec,
  duration,
  onScrollChange,
}: TimelineZoomOptions) {
  const [zoom, setZoom] = useState({ level: 1 })
  const pending = useRef<{
    level: number
    scrollLeft: number
    anchor: ZoomAnchor
  } | null>(null)

  const zoomBy = useCallback(
    (factor: number, clientX?: number) => {
      const viewport = viewportRef.current
      if (!viewport || viewport.clientWidth <= 0) return
      const previousLevel = pending.current?.level ?? zoom.level
      const level = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previousLevel * factor))
      if (level === previousLevel) return
      const pointerX =
        clientX === undefined
          ? viewport.clientWidth / 2
          : Math.max(
              0,
              Math.min(viewport.clientWidth, clientX - viewport.getBoundingClientRect().left),
            )
      // Treat near-edge wheel input as the visible left edge to avoid gradual drift.
      const viewportX = clientX !== undefined && pointerX <= LEFT_EDGE_SNAP_PX ? 0 : pointerX
      const scrollLeft = pending.current?.scrollLeft ?? viewport.scrollLeft
      const anchor = {
        timeSeconds: (scrollLeft + viewportX) / (basePxPerSec * previousLevel),
        viewportX,
      }
      // Accumulate events that arrive before React commits the new content width.
      pending.current = {
        level,
        anchor,
        scrollLeft: Math.max(
          0,
          Math.min(
            Math.max(
              0,
              getTimelineContentWidth(duration, basePxPerSec * level, viewport.clientWidth) -
                viewport.clientWidth,
            ),
            anchor.timeSeconds * basePxPerSec * level - viewportX,
          ),
        ),
      }
      setZoom({ level })
    },
    [basePxPerSec, duration, viewportRef, zoom.level],
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const request = pending.current
    if (!viewport || !request) return
    pending.current = null
    // The browser must see the new content width before it clamps scrollLeft.
    viewport.scrollLeft = Math.max(
      0,
      Math.min(
        Math.max(0, viewport.scrollWidth - viewport.clientWidth),
        request.anchor.timeSeconds * basePxPerSec * zoom.level - request.anchor.viewportX,
      ),
    )
    onScrollChange(viewport.scrollLeft)
  }, [basePxPerSec, onScrollChange, viewportRef, zoom])

  return {
    zoomLevel: zoom.level,
    zoomBy,
    canZoomIn: zoom.level < MAX_ZOOM,
    canZoomOut: zoom.level > MIN_ZOOM,
  }
}
