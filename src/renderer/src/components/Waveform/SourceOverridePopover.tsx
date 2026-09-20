import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '@shared/ProjectTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { trackPresentationColor } from '../../themes/trackColors'
import { useAnchoredPopover } from './UseAnchoredPopover'

export function SourceOverridePopover({
  anchor,
  track,
  tracks,
  start,
  end,
  onApply,
  onRestore,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>
  track: Track
  tracks: Track[]
  start: number
  end: number
  onApply(ids: string[]): boolean
  onRestore(): boolean
  onClose(): void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const position = useAnchoredPopover(anchor, ref, onClose)
  const [draft, setDraft] = useState(() => [
    ...new Set(
      track.clips.flatMap((clip) =>
        (clip.sourceOverrides ?? [])
          .filter((override) => {
            const left = clip.outputStart + override.sourceStart - clip.sourceStart
            const right = clip.outputStart + override.sourceEnd - clip.sourceStart
            return left < end && right > start
          })
          .flatMap((override) => override.stemTrackIds),
      ),
    ),
  ])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    ref.current?.querySelector('input')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (
        !ref.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        onClose()
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [anchor, onClose])
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t('waveform.replaceAudio')}
      className="crossfade-popover source-override-popover"
      style={{ position: 'fixed', ...position }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <strong>{t('waveform.replaceAudio')}</strong>
      <p>
        {start.toFixed(2)}–{end.toFixed(2)} s · {track.name}
      </p>
      <div className="mix-source-list">
        {tracks
          .filter((item) => track.mixLink?.stemTrackIds.includes(item.id))
          .map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={draft.includes(item.id)}
                onChange={(event) =>
                  setDraft(
                    event.target.checked
                      ? [...draft, item.id]
                      : draft.filter((id) => id !== item.id),
                  )
                }
              />
              <i style={{ background: trackPresentationColor(item.color) }} />
              {item.name}
            </label>
          ))}
      </div>
      {failed && <p role="alert">{t('waveform.mixCoverageFailed')}</p>}
      <button
        onClick={() => {
          if (onRestore()) onClose()
          else setFailed(true)
        }}
      >
        {t('waveform.restoreMix')}
      </button>
      <div className="mix-dialog-actions">
        <button onClick={onClose}>{t('waveform.mixCancel')}</button>
        <button
          disabled={!draft.length}
          onClick={() => {
            if (onApply(draft)) onClose()
            else setFailed(true)
          }}
        >
          {t('waveform.mixApply')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
