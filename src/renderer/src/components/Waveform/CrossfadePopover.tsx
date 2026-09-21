import { Button } from '../ui/Button'
import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MAX_CROSSFADE_DURATION_MS, type CrossfadeSettings } from '@shared/audio/CrossfadeTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { useAnchoredPopover } from './UseAnchoredPopover'

export function CrossfadePopover({
  anchor,
  settings,
  status,
  grouped,
  onChange,
  onClose,
  onEscape,
}: {
  anchor: RefObject<HTMLElement | null>
  settings: CrossfadeSettings
  status: string
  grouped: boolean
  onChange(settings: CrossfadeSettings): void
  onClose(): void
  onEscape(): void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const position = useAnchoredPopover(anchor, ref, onClose)
  useEffect(() => {
    ref.current?.querySelector('input')?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node))
        onClose()
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [anchor, onClose])
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t('waveform.editCrossfade')}
      className="crossfade-popover"
      style={{ position: 'fixed', ...position }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          onEscape()
        }
      }}
    >
      <strong>{t('waveform.editCrossfade')}</strong>
      <label>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
        />
        {t('waveform.enableCrossfade')}
      </label>
      <label>
        {t('waveform.crossfadeDuration')}
        <input
          aria-label={t('waveform.crossfadeDuration')}
          type="number"
          min={1}
          max={MAX_CROSSFADE_DURATION_MS}
          step={1}
          value={settings.durationMs}
          disabled={!settings.enabled}
          onChange={(e) => {
            const durationMs = e.currentTarget.valueAsNumber
            if (
              Number.isFinite(durationMs) &&
              durationMs >= 1 &&
              durationMs <= MAX_CROSSFADE_DURATION_MS
            )
              onChange({ ...settings, durationMs })
          }}
        />
        <span>ms</span>
      </label>
      <label>
        {t('waveform.crossfadeCurve')}
        <select
          aria-label={t('waveform.crossfadeCurve')}
          value={settings.curve}
          disabled={!settings.enabled}
          onChange={(e) =>
            onChange({ ...settings, curve: e.target.value as CrossfadeSettings['curve'] })
          }
        >
          <option value="equal-power">{t('waveform.crossfadeEqualPower')}</option>
          <option value="linear">{t('waveform.crossfadeLinear')}</option>
        </select>
      </label>
      <p role="status">{status}</p>
      {grouped && <p>{t('waveform.crossfadeGrouped')}</p>}
      <Button type="button" onClick={onClose}>
        {t('waveform.crossfadeDone')}
      </Button>
    </div>,
    document.body,
  )
}
