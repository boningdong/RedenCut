import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '@shared/ProjectTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { trackPresentationColor } from '../../themes/trackColors'
import { useAnchoredPopover } from './UseAnchoredPopover'
import { getMixRangeState } from './MixRangeState'

export function SourceOverridePopover({
  anchor,
  track,
  tracks,
  start,
  end,
  duration,
  onRangeChange,
  onApply,
  onRestore,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>
  track: Track
  tracks: Track[]
  start: number
  end: number
  duration: number
  onRangeChange(start: number, end: number): void
  onApply(ids: string[], start: number, end: number): boolean
  onRestore(start: number, end: number): boolean
  onClose(): void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const position = useAnchoredPopover(anchor, ref, onClose)
  const [bounds, setBounds] = useState({ start: String(start), end: String(end) })
  const left = Number(bounds.start),
    right = Number(bounds.end)
  const valid =
    bounds.start.trim() !== '' &&
    bounds.end.trim() !== '' &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    left >= 0 &&
    right <= duration &&
    right > left
  const state = getMixRangeState(track, left, right)
  // A user choice stays a draft while adjusting bounds; before choosing, show the actual range state.
  const [chosen, setChosen] = useState<string[] | null>(null)
  const draft = chosen ?? state.ids
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setBounds({ start: String(start), end: String(end) })
  }, [start, end])
  useEffect(() => {
    ref.current?.querySelector('input')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest?.('[data-range-handle]')) return
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose()
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
      <strong>{t('waveform.mixChooseSources')}</strong>
      <p>{t('waveform.mixMasterName', { name: track.name })}</p>
      <div className="mix-range-inputs">
        {(['start', 'end'] as const).map((edge) => (
          <label key={edge}>
            {t(edge === 'start' ? 'waveform.mixRangeStart' : 'waveform.mixRangeEnd')}
            <input
              type="number"
              min={0}
              max={duration}
              step={0.01}
              value={bounds[edge]}
              onChange={(event) => {
                setBounds({ ...bounds, [edge]: event.target.value })
                setFailed(false)
              }}
              onBlur={() => {
                if (valid) onRangeChange(left, right)
              }}
            />
          </label>
        ))}
      </div>
      {!valid && <p role="alert">{t('waveform.mixRangeInvalid')}</p>}
      {state.kind === 'mixed' && (
        <p className="mix-warning" role="status">
          {t('waveform.mixMixed')}
        </p>
      )}
      <p>{t('waveform.mixMultiChoice')}</p>
      <div className="mix-source-list">
        {tracks
          .filter((item) => track.mixLink?.stemTrackIds.includes(item.id))
          .map((item) => (
            <label key={item.id} data-checked={draft.includes(item.id)}>
              <input
                type="checkbox"
                aria-label={item.name}
                checked={draft.includes(item.id)}
                onChange={(event) => {
                  setChosen(
                    event.target.checked
                      ? [...draft, item.id]
                      : draft.filter((id) => id !== item.id),
                  )
                  setFailed(false)
                }}
              />
              <i style={{ background: trackPresentationColor(item.color) }} />
              <span>{item.name}</span>
              <small>{t('waveform.mixIndependent')}</small>
            </label>
          ))}
      </div>
      <p>
        {draft.length
          ? t('waveform.mixChoiceSummary', {
              names: draft.map((id) => tracks.find((item) => item.id === id)?.name).join(' + '),
            })
          : t('waveform.mixChooseHint')}
      </p>
      <p>{t('waveform.mixReplacementHint')}</p>
      {failed && <p role="alert">{t('waveform.mixCoverageFailed')}</p>}
      <div className="mix-dialog-actions">
        <button
          disabled={!valid || !state.hasReplacement}
          onClick={() => {
            if (onRestore(left, right)) onClose()
            else setFailed(true)
          }}
        >
          {t('waveform.restoreMix')}
        </button>
        <button onClick={onClose}>{t('waveform.mixCancel')}</button>
        <button
          className="mix-primary"
          disabled={!valid || !draft.length}
          onClick={() => {
            if (onApply(draft, left, right)) onClose()
            else setFailed(true)
          }}
        >
          {t('waveform.mixApplyReplacement')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
