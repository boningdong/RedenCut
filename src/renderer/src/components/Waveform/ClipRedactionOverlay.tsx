import React, { useEffect, useRef, useState } from 'react'
import type { Clip, ClipRedaction } from '@shared/project.types'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranslation } from '../../i18n/useTranslation'

interface Props {
  clip: Clip
  redaction: ClipRedaction
  pxPerSec: number
  onFocusTimeline(): void
}

export function ClipRedactionOverlay({ clip, redaction, pxPerSec, onFocusTimeline }: Props) {
  const { t } = useTranslation()
  const selection = useTimelineStore((s) => s.timelineSelection)
  const selected =
    selection?.kind === 'redaction' &&
    selection.clipId === clip.id &&
    selection.redactionId === redaction.id
  const [preview, setPreview] = useState<ClipRedaction | null>(null)
  const drag = useRef<{
    edge: 'sourceStart' | 'sourceEnd' | 'move'
    x: number
    clip: Clip
    original: ClipRedaction
    value: ClipRedaction
  } | null>(null)
  const ownsClick = useRef(false)
  useEffect(() => {
    const blur = () => {
      drag.current = null
      ownsClick.current = false
      setPreview(null)
    }
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [])
  const range = preview ?? redaction
  const start = Math.max(clip.sourceStart, range.sourceStart)
  const end = Math.min(clip.sourceEnd, range.sourceEnd)
  // Stable connected groups keep nested overlays reachable (A covers B and C).
  const groups: ClipRedaction[][] = []
  for (const item of [...(clip.redactions ?? [])].sort((a, b) => a.sourceStart - b.sourceStart)) {
    if (item.sourceEnd <= clip.sourceStart || item.sourceStart >= clip.sourceEnd) continue
    const group = groups[groups.length - 1]
    if (group && item.sourceStart < Math.max(...group.map((r) => r.sourceEnd))) group.push(item)
    else groups.push([item])
  }
  const overlapping = groups.find((group) => group.some((item) => item.id === redaction.id)) ?? [
    redaction,
  ]
  if (end <= start) return null
  const select = () => {
    onFocusTimeline()
    useTimelineStore.getState().selectRedaction(clip.id, redaction.id)
  }
  const cancel = () => {
    drag.current = null
    setPreview(null)
  }
  const finish = (pointerTarget: HTMLElement) => {
    if (!drag.current) return
    const { value, original, edge, clip: originalClip } = drag.current
    cancel()
    const timeline = useTimelineStore.getState()
    if (timeline.tracks.some((track) => track.clips.includes(originalClip))) {
      timeline.updateRedaction(clip.id, redaction.id, value, edge === 'move' ? 'move' : 'resize')
      if (
        edge !== 'move' &&
        (value.sourceStart !== original.sourceStart || value.sourceEnd !== original.sourceEnd)
      ) {
        timeline.setSelectedClipId(null)
        onFocusTimeline()
        pointerTarget.blur()
      }
    }
  }
  const label = t('waveform.redaction', { start: start.toFixed(2), end: end.toFixed(2) })
  return (
    <div
      className="clip-redaction"
      data-redaction-id={redaction.id}
      data-selected={selected}
      data-source-start={start}
      data-source-end={end}
      onClick={(e) => {
        if (!e.altKey || ownsClick.current) e.stopPropagation()
        ownsClick.current = false
      }}
      onPointerDown={(e) => {
        if (!e.altKey) e.stopPropagation()
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        e.stopPropagation()
        const { edge, original, x } = drag.current
        if (edge === 'move') {
          if (Math.abs(e.clientX - x) < 3 && !preview) return
          const visibleStart = Math.max(clip.sourceStart, original.sourceStart)
          const visibleEnd = Math.min(clip.sourceEnd, original.sourceEnd)
          const delta = Math.max(
            clip.sourceStart - visibleStart,
            Math.min(clip.sourceEnd - visibleEnd, (e.clientX - x) / pxPerSec),
          )
          drag.current.value = {
            ...original,
            sourceStart: original.sourceStart + delta,
            sourceEnd: original.sourceEnd + delta,
          }
          setPreview(drag.current.value)
          return
        }
        const visibleEdge =
          edge === 'sourceStart'
            ? Math.max(clip.sourceStart, original.sourceStart)
            : Math.min(clip.sourceEnd, original.sourceEnd)
        const seconds = visibleEdge + (e.clientX - x) / pxPerSec
        const bounded =
          edge === 'sourceStart'
            ? Math.max(
                clip.sourceStart,
                Math.min(Math.min(original.sourceEnd, clip.sourceEnd) - 1 / 48000, seconds),
              )
            : Math.min(
                clip.sourceEnd,
                Math.max(Math.max(original.sourceStart, clip.sourceStart) + 1 / 48000, seconds),
              )
        drag.current.value = {
          ...original,
          [edge]: bounded,
        }
        setPreview(drag.current.value)
      }}
      onPointerUp={(e) => {
        if (!drag.current) return
        e.stopPropagation()
        finish(e.target as HTMLElement)
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && drag.current) {
          e.preventDefault()
          e.stopPropagation()
          cancel()
        }
      }}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${((start - clip.sourceStart) / (clip.sourceEnd - clip.sourceStart)) * 100}%`,
        width: `${((end - start) / (clip.sourceEnd - clip.sourceStart)) * 100}%`,
        boxSizing: 'border-box',
        zIndex: selected ? 12 : 10,
        minWidth: 2,
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        title={label}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.altKey) return
          e.preventDefault()
          e.stopPropagation()
          ownsClick.current = true
          select()
          e.currentTarget.focus({ preventScroll: true })
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { edge: 'move', x: e.clientX, clip, original: redaction, value: redaction }
        }}
        onClick={(e) => {
          if (e.altKey && !ownsClick.current) return
          ownsClick.current = false
          e.stopPropagation()
          select()
          e.currentTarget.focus({ preventScroll: true })
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          padding: 0,
          border: 0,
          borderRadius: 0,
          background: 'transparent',
          cursor: 'grab',
          touchAction: 'none',
        }}
      />
      {(['sourceStart', 'sourceEnd'] as const).map((edge) => (
        <button
          key={edge}
          className="redaction-edge"
          type="button"
          aria-label={t(
            edge === 'sourceStart' ? 'waveform.redactionStart' : 'waveform.redactionEnd',
          )}
          title={t(edge === 'sourceStart' ? 'waveform.redactionStart' : 'waveform.redactionEnd')}
          onPointerDown={(e) => {
            if (e.button !== 0 || e.altKey) return
            e.preventDefault()
            e.stopPropagation()
            ownsClick.current = true
            select()
            e.currentTarget.focus({ preventScroll: true })
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { edge, x: e.clientX, clip, original: redaction, value: redaction }
          }}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
            e.preventDefault()
            e.stopPropagation()
            select()
            e.currentTarget.focus({ preventScroll: true })
            const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01)
            const value =
              edge === 'sourceStart'
                ? Math.max(clip.sourceStart, Math.min(end - 1 / 48000, start + delta))
                : Math.min(clip.sourceEnd, Math.max(start + 1 / 48000, end + delta))
            useTimelineStore.getState().updateRedaction(clip.id, redaction.id, {
              sourceStart: redaction.sourceStart,
              sourceEnd: redaction.sourceEnd,
              [edge]: value,
            })
          }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [edge === 'sourceStart' ? 'left' : 'right']: -3,
            width: 7,
            padding: 0,
            minWidth: 0,
            border: 0,
            borderRadius: 2,
            background: 'transparent',
            cursor: 'ew-resize',
            touchAction: 'none',
          }}
        />
      ))}
      {overlapping.length > 1 && (
        <button
          className="redaction-cycle"
          aria-label={t('waveform.redactionCycle')}
          title={t('waveform.redactionCycle')}
          onPointerDown={(e) => {
            if (!e.altKey) {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
          onClick={(e) => {
            if (e.altKey) return
            e.stopPropagation()
            const current = useTimelineStore.getState().timelineSelection
            const currentId =
              current?.kind === 'redaction' && current.clipId === clip.id
                ? current.redactionId
                : redaction.id
            const index = overlapping.findIndex((item) => item.id === currentId)
            onFocusTimeline()
            useTimelineStore
              .getState()
              .selectRedaction(clip.id, overlapping[(index + 1) % overlapping.length].id)
            e.currentTarget.focus({ preventScroll: true })
          }}
        >
          {overlapping.length}
        </button>
      )}
    </div>
  )
}
