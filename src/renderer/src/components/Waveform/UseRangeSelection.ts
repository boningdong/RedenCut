import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useTranscriptStore } from '../../stores/transcript.store'

interface Options {
  pxPerSec: number
  duration: number
  focusTimeline(): void
}
interface RangeGesture {
  pointerId: number
  anchorTime: number
  startClientX: number
  scale: number
  duration: number
  target: HTMLElement
  moved: boolean
}

export function useRangeSelection({ pxPerSec, duration, focusTimeline }: Options) {
  const gesture = useRef<RangeGesture | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    const release = () => {
      const active = gesture.current
      gesture.current = null
      if (active?.target.hasPointerCapture?.(active.pointerId))
        active.target.releasePointerCapture(active.pointerId)
    }
    const cancel = () => {
      if (!gesture.current) return
      suppressClick.current = true
      release()
      useEditorStore.getState().setSelection(null)
    }
    const move = (event: PointerEvent) => {
      const active = gesture.current
      if (!active || event.pointerId !== active.pointerId) return
      if (!active.moved && Math.abs(event.clientX - active.startClientX) < 3) return
      if (!active.moved) useTimelineStore.getState().setSelectedClipIds([])
      active.moved = true
      const time = Math.max(
        0,
        Math.min(
          active.duration,
          (event.clientX - active.target.getBoundingClientRect().left) / active.scale,
        ),
      )
      const timeline = useTimelineStore.getState()
      const trackId = timeline.tracks.some((track) => track.id === timeline.selectedTrackId)
        ? timeline.selectedTrackId
        : null
      const start = Math.min(active.anchorTime, time)
      const end = Math.max(active.anchorTime, time)
      useEditorStore
        .getState()
        .setSelection(end > start ? { origin: 'timeline', trackId, start, end } : null)
    }
    const finish = (event: PointerEvent) => {
      if (!gesture.current || event.pointerId !== gesture.current.pointerId) return
      move(event)
      suppressClick.current = gesture.current.moved
      release()
    }
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) cancel()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gesture.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
    }
    const unsubscribe = useTimelineStore.subscribe((state, previous) => {
      const selection = useEditorStore.getState().selection
      if (
        state.projectGeneration === previous.projectGeneration &&
        selection?.origin === 'timeline'
      ) {
        const trackId = state.tracks.some((track) => track.id === state.selectedTrackId)
          ? state.selectedTrackId
          : null
        if (selection.trackId !== trackId)
          useEditorStore.getState().setSelection({ ...selection, trackId })
        return
      }
      if (
        state.projectGeneration !== previous.projectGeneration ||
        (state.selectedTrackId !== previous.selectedTrackId &&
          !(selection?.origin === 'transcript' && selection.trackId === state.selectedTrackId)) ||
        (selection && !state.tracks.some((track) => track.id === selection.trackId))
      ) {
        cancel()
        useEditorStore.getState().setSelection(null)
        useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set())
        window.getSelection()?.removeAllRanges()
      }
    })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    return () => {
      unsubscribe()
      cancel()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
    }
  }, [])

  const isActive = useCallback(() => gesture.current !== null, [])
  return {
    isActive,
    begin(event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || gesture.current || duration <= 0) return
      event.preventDefault()
      event.stopPropagation()
      focusTimeline()
      const target = event.currentTarget
      suppressClick.current = false
      gesture.current = {
        pointerId: event.pointerId,
        target,
        scale: pxPerSec,
        duration,
        startClientX: event.clientX,
        anchorTime: Math.max(
          0,
          Math.min(duration, (event.clientX - target.getBoundingClientRect().left) / pxPerSec),
        ),
        moved: false,
      }
      target.setPointerCapture?.(event.pointerId)
    },
    consumeClick() {
      const consumed = suppressClick.current
      suppressClick.current = false
      return consumed
    },
  }
}
