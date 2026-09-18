import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
import { usePlaybackStore } from '../../stores/playback.store'
import { useTranscriptStore } from '../../stores/transcript.store'

/** Owns viewport movement only; playback and transcript selection remain independent. */
export function useTranscriptPlaybackFollow(
  units: TranscriptOccurrence[],
  container: RefObject<HTMLDivElement | null>,
  elements: RefObject<Map<string, HTMLSpanElement>>,
  displayMode: string,
) {
  const targetId = useRef<string | null>(null)
  const index = useMemo(() => {
    let end = -Infinity
    return units
      .filter(
        (u) =>
          u.unit.kind === 'speech' && !u.muted && u.outputStart !== null && u.outputEnd !== null,
      )
      .sort((a, b) => a.outputStart! - b.outputStart!)
      .map((unit) => ({ unit, maxEnd: (end = Math.max(end, unit.outputEnd!)) }))
  }, [units])
  const byId = useMemo(() => new Map(index.map(({ unit }) => [unit.id, unit])), [index])
  const locate = useCallback(
    (nearest = false) => {
      const time = usePlaybackStore.getState().currentTime
      const previous = targetId.current ? byId.get(targetId.current) : undefined
      if (previous && time >= previous.outputStart! && time < previous.outputEnd!)
        return previous.id
      let low = 0,
        high = index.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (index[middle].unit.outputStart! <= time) low = middle + 1
        else high = middle
      }
      for (let i = low - 1; i >= 0 && index[i].maxEnd > time; i--) {
        if (index[i].unit.outputEnd! > time) return index[i].unit.id
      }
      if (!nearest) return null
      // A one-shot jump may land between words. Measure against interval edges,
      // preserving chronological order on ties; follow still requires active speech.
      let closest: string | null = null
      let distance = Infinity
      for (const { unit } of index) {
        const candidate = Math.max(unit.outputStart! - time, time - unit.outputEnd!, 0)
        if (candidate < distance) {
          closest = unit.id
          distance = candidate
        }
      }
      return closest
    },
    [index, byId],
  )
  const move = useCallback(
    (id: string, center: boolean) => {
      const viewport = container.current
      const element = elements.current.get(id)
      if (!viewport || !element) return false
      const bounds = viewport.getBoundingClientRect()
      const text = element.getBoundingClientRect()
      if (!bounds.height) return false
      const margin = Math.min(64, bounds.height / 4)
      if (!center && text.top >= bounds.top + margin && text.bottom <= bounds.bottom - margin)
        return true
      viewport.scrollTo({
        top: Math.max(
          0,
          viewport.scrollTop + text.top - bounds.top - (bounds.height - text.height) / 2,
        ),
        behavior:
          center && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            ? 'smooth'
            : 'instant',
      })
      return true
    },
    [container, elements],
  )
  const jump = useCallback(() => {
    const id = locate(true)
    targetId.current = id
    return id !== null && move(id, true)
  }, [locate, move])

  useEffect(() => {
    const viewport = container.current
    if (!viewport) return
    targetId.current = null
    let lastId: string | null = null
    const follow = (force = false) => {
      if (!useTranscriptStore.getState().followPlayback) return
      const id = locate()
      targetId.current = id
      if (id && (force || id !== lastId)) move(id, false)
      lastId = id
    }
    const stop = () => useTranscriptStore.getState().setFollowPlayback(false)
    const wheel = (event: WheelEvent) => {
      if (event.deltaX || event.deltaY) stop()
    }
    const keys = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) stop()
    }
    // Native scrollbar interaction must stop follow, but programmatic scroll events must not.
    let pointerDown = false
    const down = () => {
      pointerDown = true
    }
    const up = () => {
      pointerDown = false
    }
    const scroll = () => {
      if (pointerDown) stop()
    }
    const selection = () => {
      const selected = window.getSelection()
      if (
        selected &&
        !selected.isCollapsed &&
        selected.rangeCount &&
        viewport.contains(selected.getRangeAt(0).commonAncestorContainer)
      )
        stop()
    }
    const playback = usePlaybackStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) follow()
    })
    const transcript = useTranscriptStore.subscribe((state, previous) => {
      if (state.followPlayback && !previous.followPlayback) follow(true)
    })
    viewport.addEventListener('wheel', wheel, { passive: true })
    viewport.addEventListener('touchmove', stop, { passive: true })
    viewport.addEventListener('keydown', keys)
    viewport.addEventListener('pointerdown', down)
    viewport.addEventListener('scroll', scroll)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    document.addEventListener('selectionchange', selection)
    const resize =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => follow(true)) : null
    resize?.observe(viewport)
    follow(true)
    return () => {
      playback()
      transcript()
      resize?.disconnect()
      viewport.removeEventListener('wheel', wheel)
      viewport.removeEventListener('touchmove', stop)
      viewport.removeEventListener('keydown', keys)
      viewport.removeEventListener('pointerdown', down)
      viewport.removeEventListener('scroll', scroll)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      document.removeEventListener('selectionchange', selection)
    }
  }, [container, locate, move, displayMode])
  return jump
}
