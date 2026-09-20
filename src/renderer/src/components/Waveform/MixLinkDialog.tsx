import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '@shared/ProjectTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { trackPresentationColor } from '../../themes/trackColors'

export function MixLinkDialog({
  track,
  tracks,
  onApply,
  onClose,
}: {
  track: Track
  tracks: Track[]
  onApply(ids: string[]): boolean
  onClose(): void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(track.mixLink?.stemTrackIds ?? [])
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirmedRemoval, setConfirmedRemoval] = useState(false)
  const [failed, setFailed] = useState(false)
  const owned = new Set(
    tracks
      .filter((item) => item.id !== track.id)
      .flatMap((item) => item.mixLink?.stemTrackIds ?? []),
  )
  const candidates = tracks.filter(
    (item) => item.id !== track.id && !item.mixLink && !owned.has(item.id),
  )
  const affected = track.clips.some((clip) =>
    clip.sourceOverrides?.some((override) =>
      override.stemTrackIds.some((id) => !draft.includes(id)),
    ),
  )
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => previous?.focus()
  }, [])
  return createPortal(
    <div
      className="mix-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('waveform.mixSources')}
        className="mix-link-dialog"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Tab') {
            const focusable = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled)',
              ) ?? []),
            ]
            const first = focusable[0],
              last = focusable[focusable.length - 1]
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === ref.current)
            ) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <strong>
          {t('waveform.mixSources')} · {track.name}
        </strong>
        <p>{t('waveform.mixAlignmentWarning')}</p>
        <div className="mix-source-list">
          {candidates.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={draft.includes(item.id)}
                onChange={(event) => {
                  setConfirmedRemoval(false)
                  setDraft(
                    event.target.checked
                      ? [...draft, item.id]
                      : draft.filter((id) => id !== item.id),
                  )
                }}
              />
              <i style={{ background: trackPresentationColor(item.color) }} />
              {item.name}
            </label>
          ))}
          {!candidates.length && <p>{t('waveform.mixNoSources')}</p>}
        </div>
        {draft.length > 0 && (
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            {t('waveform.mixAligned')}
          </label>
        )}
        {affected && (
          <label className="mix-warning">
            <input
              type="checkbox"
              checked={confirmedRemoval}
              onChange={(event) => setConfirmedRemoval(event.target.checked)}
            />
            {t('waveform.mixDetachWarning')}
          </label>
        )}
        {failed && <p role="alert">{t('waveform.mixLinkFailed')}</p>}
        <div className="mix-dialog-actions">
          <button onClick={onClose}>{t('waveform.mixCancel')}</button>
          <button
            disabled={(draft.length > 0 && !acknowledged) || (affected && !confirmedRemoval)}
            onClick={() => {
              if (onApply(draft)) onClose()
              else setFailed(true)
            }}
          >
            {t('waveform.mixApply')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
