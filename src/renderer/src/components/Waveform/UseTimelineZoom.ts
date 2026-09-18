import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { getTimelineContentWidth } from './TimelineViewportGeometry'

const MIN_ZOOM = 1 / 32
const MAX_PIXELS_PER_SECOND = 1000
// Leave headroom below Chromium’s layout limit for the trailing viewport.
const MAX_AUDIO_WIDTH = 32_000_000
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
  const maxScale = Math.min(MAX_PIXELS_PER_SECOND, MAX_AUDIO_WIDTH / Math.max(1, duration))
  const maxZoom = maxScale / basePxPerSec
  const minZoom = Math.min(MIN_ZOOM, maxZoom)
  const zoomLevel = Math.min(zoom.level, maxZoom)
  const pending = useRef<{
    level: number
    scrollLeft: number
    anchor: ZoomAnchor
  } | null>(null)

  const zoomBy = useCallback(
    (factor: number, clientX?: number) => {
      const viewport = viewportRef.current
      if (!viewport || viewport.clientWidth <= 0) return
      const previousLevel = pending.current?.level ?? zoomLevel
      const level = Math.min(maxZoom, Math.max(minZoom, previousLevel * factor))
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
    [basePxPerSec, duration, viewportRef, zoomLevel, maxZoom, minZoom],
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
        request.anchor.timeSeconds * basePxPerSec * zoomLevel - request.anchor.viewportX,
      ),
    )
    onScrollChange(viewport.scrollLeft)
  }, [basePxPerSec, onScrollChange, viewportRef, zoom, zoomLevel])

  return {
    zoomLevel,
    zoomBy,
    canZoomIn: zoomLevel < maxZoom,
    canZoomOut: zoomLevel > minZoom,
  }
}
