import { hasSamePlaybackStructure } from '../../audio/PlaybackStructure'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Clip, ClipRedaction, Track } from '@shared/ProjectTypes'
import { DEFAULT_CROSSFADE_SETTINGS, type CrossfadeSettings } from '@shared/audio/CrossfadeTypes'
import { resolveRedactionTransitions } from '@shared/audio/RedactionTransitionResolver'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useTranslation } from '../../i18n/useTranslation'
import { CrossfadePopover } from './CrossfadePopover'

const resolutionCache = new WeakMap<Track[], ReturnType<typeof resolveRedactionTransitions>>()
let latestResolution:
  { tracks: Track[]; result: ReturnType<typeof resolveRedactionTransitions> } | undefined
function transitionsFor(tracks: Track[]) {
  let result = resolutionCache.get(tracks)
  if (!result) {
    result =
      latestResolution && hasSamePlaybackStructure(latestResolution.tracks, tracks)
        ? latestResolution.result
        : resolveRedactionTransitions(tracks)
    resolutionCache.set(tracks, result)
  }
  latestResolution = { tracks, result }
  return result
}

export function RedactionCrossfadeOverlay({
  clip,
  redaction,
  pxPerSec,
  editing,
  anchor,
  onClose,
}: {
  clip: Clip
  redaction: ClipRedaction
  pxPerSec: number
  editing: boolean
  anchor: RefObject<HTMLElement | null>
  onClose(): void
}) {
  const { t } = useTranslation()
  const tracks = useTimelineStore((s) => s.tracks)
  const selection = useTimelineStore((s) => s.timelineSelection)
  const [draft, setDraft] = useState<CrossfadeSettings | null>(null)
  const gesture = useRef<{
    x: number
    direction: number
    original: CrossfadeSettings
    value: CrossfadeSettings
    clip: Clip
  } | null>(null)
  const settings = draft ?? redaction.crossfade ?? { ...DEFAULT_CROSSFADE_SETTINGS, enabled: false }
  const resolutions = useMemo(
    () =>
      transitionsFor(
        draft
          ? tracks.map((track) => ({
              ...track,
              clips: track.clips.map((c) =>
                c.id === clip.id
                  ? {
                      ...c,
                      redactions: c.redactions?.map((r) =>
                        r.id === redaction.id ? { ...r, crossfade: draft } : r,
                      ),
                    }
                  : c,
              ),
            }))
          : tracks,
      ),
    [tracks, draft, clip.id, redaction.id],
  )
  const resolution = resolutions.find(
    (r) => r.owner.clipId === clip.id && r.owner.redactionIds.includes(redaction.id),
  )
  const transition = resolution?.status === 'active' ? resolution.transition : null
  const groupEditing =
    selection?.kind === 'redaction' &&
    selection.editingCrossfade &&
    selection.clipId === clip.id &&
    resolution?.owner.redactionIds.includes(selection.redactionId)
  const showWings =
    transition && (editing || (!groupEditing && resolution?.owner.redactionIds[0] === redaction.id))
  const start = Math.max(clip.sourceStart, redaction.sourceStart)
  const end = Math.min(clip.sourceEnd, redaction.sourceEnd)
  const timelineStart = clip.outputStart + start - clip.sourceStart
  const width = showWings ? (transition.frameCount / 48000) * pxPerSec : 0
  const left = showWings
    ? (transition.leftTimelineStartFrame / 48000 - timelineStart) * pxPerSec
    : 0
  const right = showWings
    ? (transition.rightTimelineStartFrame / 48000 - timelineStart) * pxPerSec
    : (end - start) * pxPerSec
  const cancel = useCallback(() => {
    gesture.current = null
    setDraft(null)
  }, [])
  const close = useCallback(() => {
    cancel()
    onClose()
  }, [cancel, onClose])
  const escape = () => {
    if (gesture.current) cancel()
    else close()
  }
  useEffect(() => {
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [cancel])
  const commit = (value: CrossfadeSettings) => {
    useTimelineStore.getState().updateRedactionCrossfade(clip.id, redaction.id, value)
  }
  const status = transition
    ? t('waveform.crossfadeEffective', { duration: (transition.frameCount / 48).toFixed(1) })
    : t(
        `waveform.crossfadeReason.${resolution?.status === 'inactive' ? resolution.reason : 'no-join'}`,
      )
  return (
    <>
      {settings.enabled && <div className="redaction-frame" aria-hidden="true" />}
      {settings.enabled && (
        <div
          className="crossfade-rails"
          aria-hidden="true"
          style={
            {
              left,
              width: right + width - left,
              '--fade-width': `${width}px`,
            } as React.CSSProperties
          }
        />
      )}
      {showWings && (
        <>
          <div
            className="crossfade-wing crossfade-wing-left"
            aria-hidden="true"
            style={{ left, width }}
          />
          <div
            className="crossfade-wing crossfade-wing-right"
            aria-hidden="true"
            style={{ left: right, width }}
          />
          {editing && (
            <>
              <svg
                className="crossfade-envelope"
                aria-hidden="true"
                style={{ left, width }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path
                  d={settings.curve === 'linear' ? 'M0 0 L100 100' : 'M0 0 C55 0 100 55 100 100'}
                />
              </svg>
              <svg
                className="crossfade-envelope"
                aria-hidden="true"
                style={{ left: right, width }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path
                  d={settings.curve === 'linear' ? 'M0 100 L100 0' : 'M0 100 C0 45 45 0 100 0'}
                />
              </svg>
            </>
          )}
        </>
      )}
      {editing && (
        <>
          {settings.enabled &&
            transition &&
            (['left', 'right'] as const).map((side) => (
              <button
                key={side}
                type="button"
                role="slider"
                className="crossfade-handle"
                aria-label={t(
                  side === 'left' ? 'waveform.crossfadeLeft' : 'waveform.crossfadeRight',
                )}
                aria-valuemin={1}
                aria-valuemax={100}
                aria-valuenow={settings.durationMs}
                style={{ left: side === 'left' ? left : right + width }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || e.altKey) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.currentTarget.focus()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  gesture.current = {
                    x: e.clientX,
                    direction: side === 'left' ? -1 : 1,
                    original: settings,
                    value: settings,
                    clip,
                  }
                }}
                onPointerMove={(e) => {
                  const current = gesture.current
                  if (!current) return
                  e.stopPropagation()
                  current.value = {
                    ...current.original,
                    durationMs: Math.max(
                      1,
                      Math.min(
                        100,
                        current.original.durationMs +
                          ((current.direction * (e.clientX - current.x)) / pxPerSec) * 1000,
                      ),
                    ),
                  }
                  setDraft(current.value)
                }}
                onPointerUp={(e) => {
                  if (!gesture.current) return
                  e.stopPropagation()
                  const current = gesture.current
                  cancel()
                  if (
                    useTimelineStore
                      .getState()
                      .tracks.some((track) => track.clips.includes(current.clip))
                  )
                    commit(current.value)
                }}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    escape()
                  } else if (
                    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                      e.key,
                    )
                  ) {
                    e.preventDefault()
                    const durationMs =
                      e.key === 'Home'
                        ? 1
                        : e.key === 'End'
                          ? 100
                          : Math.max(
                              1,
                              Math.min(
                                100,
                                settings.durationMs +
                                  (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1) *
                                    (e.shiftKey ? 10 : 1),
                              ),
                            )
                    commit({ ...settings, durationMs })
                  }
                }}
              />
            ))}
          <CrossfadePopover
            anchor={anchor}
            settings={settings}
            status={status}
            grouped={(resolution?.owner.redactionIds.length ?? 0) > 1}
            onChange={commit}
            onClose={close}
            onEscape={escape}
          />
        </>
      )}
    </>
  )
}
