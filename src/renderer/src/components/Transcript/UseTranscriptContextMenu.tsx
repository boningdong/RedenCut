import { useCallback, useState, type MouseEvent } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
import { useTimelineStore } from '../../stores/TimelineStore'
import { EditorContextMenu, type ContextMenuItem } from '../ui/EditorContextMenu'

export function useTranscriptContextMenu(
  units: TranscriptOccurrence[],
  redact: () => (() => void) | null,
) {
  const { t } = useTranslation()
  const generation = useTimelineStore((s) => s.projectGeneration)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
    units: TranscriptOccurrence[]
    generation: number
  } | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const close = useCallback(() => setMenu(null), [])
  const open = (event: MouseEvent<HTMLElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-occurrence-id]')
    const occurrence = units.find((unit) => unit.id === target?.dataset.occurrenceId)
    const selection = window.getSelection()
    const ownsSelection =
      selection &&
      !selection.isCollapsed &&
      selection.rangeCount &&
      event.currentTarget.contains(selection.getRangeAt(0).commonAncestorContainer)
    const items: ContextMenuItem[] = []
    const tracks = useTimelineStore.getState().tracks
    const valid = () =>
      useTimelineStore.getState().tracks === tracks &&
      useTimelineStore.getState().projectGeneration === generation
    const action = ownsSelection ? redact() : null
    if (action)
      items.push({
        id: 'redact',
        label: t('waveform.redact'),
        action: () => {
          if (valid()) action()
        },
      })
    if (ownsSelection) {
      const text = selection.toString()
      items.push({
        id: 'copy',
        label: t('waveform.copyText'),
        action: () => {
          if (!navigator.clipboard?.writeText) {
            setCopyFailed(true)
            return
          }
          void navigator.clipboard.writeText(text).catch(() => setCopyFailed(true))
        },
      })
    }
    if (occurrence?.sourceStart !== null && occurrence?.sourceEnd !== null && occurrence) {
      const overlays = (occurrence.clip.redactions ?? []).filter(
        (r) => r.sourceStart < occurrence.sourceEnd! && r.sourceEnd > occurrence.sourceStart!,
      )
      for (const overlay of overlays) {
        items.push({
          id: overlay.id,
          separator: items.length > 0 && overlay === overlays[0],
          label:
            overlays.length === 1
              ? t('waveform.removeRedact')
              : t('waveform.removeRedactRange', {
                  start: (
                    occurrence.clip.outputStart +
                    Math.max(overlay.sourceStart, occurrence.clip.sourceStart) -
                    occurrence.clip.sourceStart
                  ).toFixed(2),
                  end: (
                    occurrence.clip.outputStart +
                    Math.min(overlay.sourceEnd, occurrence.clip.sourceEnd) -
                    occurrence.clip.sourceStart
                  ).toFixed(2),
                }),
          action: () => {
            if (valid()) useTimelineStore.getState().removeRedaction(occurrence.clip.id, overlay.id)
          },
        })
      }
    }
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    setCopyFailed(false)
    setMenu({ x: event.clientX, y: event.clientY, items, units, generation })
  }
  return {
    open,
    menu:
      menu && menu.units === units && menu.generation === generation ? (
        <EditorContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} />
      ) : null,
    error: copyFailed ? <div role="status">{t('waveform.copyTextFailed')}</div> : null,
  }
}
