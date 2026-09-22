import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { Clip, Track } from '@shared/ProjectTypes'
import { linkedMasterForTrack } from '../../domain/MixLinkEdits'
import { planClipPlacement } from '../../domain/TimelinePlacement'
import { trimClip } from '../../domain/TimelineEdits'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/TimelineStore'

interface Options {
  containerRef: RefObject<HTMLDivElement | null>
  viewportRef: RefObject<HTMLDivElement | null>
  pxPerSec: number
  focusTimeline(): void
}
export interface ClipPreview {
  tracks: Track[]
  clipIds: string[]
  targetTrackId?: string
  guideTime?: number
  invalid: boolean
}
interface Gesture {
  kind: 'move' | 'start' | 'end' | 'marquee'
  tracks: Track[]
  ids: string[]
  clip?: Clip
  x: number
  y: number
  lastX: number
  lastY: number
  scroll: number
  scale: number
  pointerId: number
  target: HTMLElement
  moved: boolean
  clickSelection: 'deselect' | 'collapse' | null
  next: ClipPreview | null
  marqueeIds?: string[]
}
interface Marquee {
  left: number
  top: number
  width: number
  height: number
}

export function useClipInteraction({
  containerRef,
  viewportRef,
  pxPerSec,
  focusTimeline,
}: Options) {
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<ClipPreview | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)

  useEffect(() => {
    let frame = 0
    const lanes = () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-lane]') ?? [])
    const clear = () => {
      const active = gesture.current
      gesture.current = null
      cancelAnimationFrame(frame)
      if (active?.target.hasPointerCapture?.(active.pointerId))
        active.target.releasePointerCapture(active.pointerId)
      setPreview(null)
      setMarquee(null)
    }
    const update = (x: number, y: number) => {
      const active = gesture.current
      if (!active) return
      active.lastX = x
      active.lastY = y
      if (!active.moved && Math.hypot(x - active.x, y - active.y) < 3) return
      active.moved = true
      const scrollDelta = (viewportRef.current?.scrollLeft ?? 0) - active.scroll
      const delta = (x - active.x + scrollDelta) / active.scale
      if (active.kind === 'marquee') {
        const box = {
          left: Math.min(active.x - scrollDelta, x),
          top: Math.min(active.y, y),
          width: Math.abs(x - active.x + scrollDelta),
          height: Math.abs(y - active.y),
        }
        const hitIds: string[] = []
        for (const lane of lanes()) {
          if (linkedMasterForTrack(active.tracks, lane.dataset.lane ?? '')) continue
          const rect = lane.getBoundingClientRect()
          if (rect.bottom < box.top || rect.top > box.top + box.height) continue
          const from = (box.left - rect.left) / active.scale
          const to = (box.left + box.width - rect.left) / active.scale
          for (const clip of active.tracks.find((track) => track.id === lane.dataset.lane)?.clips ??
            []) {
            if (
              clip.outputStart < to &&
              clip.outputStart + clip.sourceEnd - clip.sourceStart > from
            )
              hitIds.push(clip.id)
          }
        }
        active.marqueeIds = [...new Set([...active.ids, ...hitIds])]
        setMarquee(box)
        useTimelineStore.getState().setSelectedClipIds(active.marqueeIds)
        return
      }
      const clip = active.clip!
      if (active.kind !== 'move') {
        const source = useTimelineStore
          .getState()
          .audioSources.find((item) => item.id === clip.audioSourceId)
        const edge =
          active.kind === 'start'
            ? clip.outputStart
            : clip.outputStart + clip.sourceEnd - clip.sourceStart
        const next = source
          ? trimClip(
              active.tracks,
              clip.id,
              active.kind,
              edge + delta,
              source.metadata.durationSeconds,
            )
          : null
        active.next = {
          tracks: next ?? active.tracks,
          clipIds: [clip.id],
          targetTrackId: clip.trackId,
          invalid: !next,
        }
      } else {
        const lane = lanes().find((element) => {
          const rect = element.getBoundingClientRect()
          const viewport = viewportRef.current?.getBoundingClientRect()
          return (
            y >= rect.top &&
            y <= rect.bottom &&
            x >= (viewport?.left ?? rect.left) &&
            x <= (viewport?.right ?? rect.right)
          )
        })
        const targetTrackId = lane?.dataset.lane
        const state = useTimelineStore.getState()
        const result = targetTrackId
          ? planClipPlacement(
              active.tracks,
              active.ids,
              clip.id,
              clip.outputStart + delta,
              targetTrackId,
              {
                insert: state.insertMode,
                snapThreshold: state.snappingEnabled ? 5 / active.scale : undefined,
              },
            )
          : null
        active.next = {
          tracks: result?.tracks ?? active.tracks,
          clipIds: active.ids,
          targetTrackId,
          guideTime: result?.guideTime,
          invalid: !result,
        }
      }
      setPreview(active.next)
    }
    const scrollAtEdge = () => {
      const active = gesture.current
      const viewport = viewportRef.current
      if (!active || !viewport) return
      if (active.moved) {
        const rect = viewport.getBoundingClientRect()
        const speed = active.lastX < rect.left + 28 ? -10 : active.lastX > rect.right - 28 ? 10 : 0
        const before = viewport.scrollLeft
        if (speed) viewport.scrollLeft += speed
        if (viewport.scrollLeft !== before) update(active.lastX, active.lastY)
      }
      frame = requestAnimationFrame(scrollAtEdge)
    }
    const move = (event: PointerEvent) => {
      if (!gesture.current || event.pointerId !== gesture.current.pointerId) return
      update(event.clientX, event.clientY)
      if (!frame) frame = requestAnimationFrame(scrollAtEdge)
    }
    const finish = (event: PointerEvent) => {
      const active = gesture.current
      if (!active || event.pointerId !== active.pointerId) return
      if (active.moved) update(event.clientX, event.clientY)
      if (active.kind === 'marquee' && !active.moved) suppressClick.current = false
      if (!active.moved && active.clip && active.clickSelection) {
        useTimelineStore
          .getState()
          .setSelectedClipIds(active.clickSelection === 'deselect' ? [] : [active.clip.id])
      }
      if (active.moved && active.next && !active.next.invalid) {
        useTimelineStore
          .getState()
          .commitTracks(
            active.tracks,
            active.next.tracks,
            active.kind === 'move' ? 'Move clips' : 'Trim clip',
            active.next.clipIds,
          )
      }
      clear()
      frame = 0
    }
    const cancel = () => {
      const active = gesture.current
      if (active?.kind === 'marquee') useTimelineStore.getState().setSelectedClipIds(active.ids)
      clear()
      frame = 0
    }
    const key = (event: KeyboardEvent) => {
      if (gesture.current && event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        cancel()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
    }
  }, [containerRef, viewportRef])

  const select = (clip: Clip, additive: boolean) => {
    focusTimeline()
    const timeline = useTimelineStore.getState()
    const ids = timeline.selectedClipIds
    const next = additive
      ? ids.includes(clip.id)
        ? ids.filter((id) => id !== clip.id)
        : [...ids, clip.id]
      : ids.includes(clip.id)
        ? ids
        : [clip.id]
    timeline.setSelectedClipIds(next, clip.id)
    timeline.setSelectedTrackId(clip.trackId)
    useEditorStore.getState().setSelection(
      next.length === 1
        ? {
            origin: 'clip',
            trackId: clip.trackId,
            start: clip.outputStart,
            end: clip.outputStart + clip.sourceEnd - clip.sourceStart,
          }
        : null,
    )
    return next
  }
  const begin = (event: ReactPointerEvent, clip?: Clip, edge?: 'start' | 'end') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick.current = true
    const before = useTimelineStore.getState().selectedClipIds
    const ids = clip ? select(clip, !edge && event.shiftKey) : event.shiftKey ? before : []
    if (clip && !ids.includes(clip.id)) return
    if (!clip) {
      focusTimeline()
      useTimelineStore.getState().setSelectedClipIds(ids)
    }
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)
    gesture.current = {
      kind: edge ?? (clip ? 'move' : 'marquee'),
      tracks: useTimelineStore.getState().tracks,
      ids,
      clip,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      scroll: viewportRef.current?.scrollLeft ?? 0,
      scale: pxPerSec,
      pointerId: event.pointerId,
      target,
      moved: false,
      clickSelection:
        clip && !edge && !event.shiftKey && before.includes(clip.id)
          ? before.length === 1
            ? 'deselect'
            : 'collapse'
          : null,
      next: null,
    }
  }
  const clickClip = (event: ReactMouseEvent, clip: Clip) => {
    event.stopPropagation()
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const ids = useTimelineStore.getState().selectedClipIds
    const deselect = !event.shiftKey && ids.length === 1 && ids[0] === clip.id
    select(clip, event.shiftKey)
    if (deselect) useTimelineStore.getState().setSelectedClipIds([])
    else if (!event.shiftKey) useTimelineStore.getState().setSelectedClipIds([clip.id])
  }
  const consumeClick = () => {
    const consumed = suppressClick.current
    suppressClick.current = false
    return consumed
  }
  const trimKey = (event: ReactKeyboardEvent<HTMLElement>, clip: Clip, edge: 'start' | 'end') => {
    if (
      !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return
    event.preventDefault()
    event.stopPropagation()
    const state = useTimelineStore.getState()
    const source = state.audioSources.find((item) => item.id === clip.audioSourceId)
    if (!source) return
    select(clip, false)
    event.currentTarget.focus({ preventScroll: true })
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01)
    const time =
      edge === 'start' ? clip.outputStart : clip.outputStart + clip.sourceEnd - clip.sourceStart
    const next = trimClip(
      state.tracks,
      clip.id,
      edge,
      time + delta,
      source.metadata.durationSeconds,
    )
    if (next) state.commitTracks(state.tracks, next, 'Trim clip', [clip.id])
  }
  const isActive = useCallback(() => gesture.current !== null, [])
  return { preview, marquee, begin, clickClip, consumeClick, trimKey, isActive }
}
