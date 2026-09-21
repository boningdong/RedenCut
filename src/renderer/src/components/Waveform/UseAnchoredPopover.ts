import { useLayoutEffect, useState, type RefObject } from 'react'

export function placePopover(
  anchor: { left: number; right: number; top: number; bottom: number },
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  preferAbove = false,
) {
  const above = Math.max(0, anchor.top - 16)
  const below = Math.max(0, viewportHeight - anchor.bottom - 16)
  const onTop = height <= above || (preferAbove && above >= 180) || above >= below
  const maxHeight = onTop ? above : below
  return {
    left: Math.max(
      8,
      Math.min((anchor.left + anchor.right - width) / 2, viewportWidth - width - 8),
    ),
    top: onTop ? Math.max(8, anchor.top - Math.min(height, maxHeight) - 8) : anchor.bottom + 8,
    maxHeight,
  }
}

export function useAnchoredPopover(
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  onMissing: () => void,
  avoidLane = false,
) {
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: window.innerHeight - 16 })
  useLayoutEffect(() => {
    const measure = () => {
      if (!anchor.current || !panel.current) return
      const anchorRect = anchor.current.getBoundingClientRect()
      const laneRect = avoidLane
        ? anchor.current.closest('[data-lane]')?.getBoundingClientRect()
        : null
      const rect = laneRect
        ? {
            ...anchorRect,
            left: anchorRect.left,
            right: anchorRect.right,
            top: laneRect.top,
            bottom: laneRect.bottom,
          }
        : anchorRect
      let left = Math.max(0, rect.left),
        right = Math.min(window.innerWidth, rect.right)
      let top = Math.max(0, rect.top),
        bottom = Math.min(window.innerHeight, rect.bottom)
      let parent = anchor.current.parentElement
      while (parent) {
        const style = getComputedStyle(parent)
        if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
          const bounds = parent.getBoundingClientRect()
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
        parent = parent.parentElement
      }
      if (right <= left || bottom <= top) {
        onMissing()
        return
      }
      const size = panel.current.getBoundingClientRect()
      const next = placePopover(
        { left, right, top, bottom },
        size.width,
        size.height,
        window.innerWidth,
        window.innerHeight,
        avoidLane,
      )
      setPosition((old) =>
        old.left === next.left && old.top === next.top && old.maxHeight === next.maxHeight
          ? old
          : next,
      )
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (anchor.current) observer?.observe(anchor.current)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    // Layout can change without a resize (timeline zoom, panel moves).
    let frame = 0
    const tick = () => {
      measure()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor, panel, onMissing, avoidLane])
  return position
}
