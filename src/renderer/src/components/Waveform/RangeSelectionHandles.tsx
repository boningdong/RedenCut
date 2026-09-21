import { useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useEditorStore, type EditorSelection } from '../../stores/editor.store'

export function RangeSelectionHandles({
  selection,
  pxPerSec,
  duration,
  onCommit,
}: {
  selection: EditorSelection
  pxPerSec: number
  duration: number
  onCommit?(next: EditorSelection, original: EditorSelection): boolean
}) {
  const { t } = useTranslation()
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const gesture = useRef<{
    edge: 'start' | 'end'
    x: number
    scale: number
    duration: number
    original: EditorSelection
  } | null>(null)
  function resized(original: EditorSelection, edge: 'start' | 'end', value: number, limit: number) {
    return {
      ...original,
      [edge]:
        edge === 'start'
          ? Math.max(0, Math.min(original.end - 0.001, value))
          : Math.min(limit, Math.max(original.start + 0.001, value)),
    }
  }
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = gesture.current
      if (!active) return
      useEditorStore
        .getState()
        .setSelection(
          resized(
            active.original,
            active.edge,
            active.original[active.edge] + (event.clientX - active.x) / active.scale,
            active.duration,
          ),
        )
    }
    const finish = (event: PointerEvent) => {
      const active = gesture.current
      if (!active) return
      move(event)
      const next = useEditorStore.getState().selection
      if (
        next &&
        (next.start !== active.original.start || next.end !== active.original.end) &&
        commitRef.current?.(next, active.original) === false
      )
        useEditorStore.getState().setSelection(active.original)
      gesture.current = null
    }
    const cancel = () => {
      if (gesture.current) useEditorStore.getState().setSelection(gesture.current.original)
      gesture.current = null
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
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
      gesture.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
    }
  }, [])
  return (
    <>
      {(['start', 'end'] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          data-range-handle={edge}
          className="mix-range-handle"
          style={{ left: selection[edge] * pxPerSec - 4 }}
          aria-label={t(
            edge === 'start' ? 'waveform.mixRangeStartHandle' : 'waveform.mixRangeEndHandle',
          )}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            gesture.current = {
              edge,
              x: event.clientX,
              scale: pxPerSec,
              duration,
              original: selection,
            }
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const step = (event.shiftKey ? 0.1 : 0.01) * (event.key === 'ArrowLeft' ? -1 : 1)
            const next = resized(selection, edge, selection[edge] + step, duration)
            if (onCommit?.(next, selection) !== false) useEditorStore.getState().setSelection(next)
          }}
        />
      ))}
    </>
  )
}
