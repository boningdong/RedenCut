import { useCallback, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
import { TrackControlPopover } from './TrackControlPopover'

export function TrackEffectsMenu({
  active,
  normalized,
  onToggleNormalize,
}: {
  active: boolean
  normalized: boolean
  onToggleNormalize(): void
}) {
  const { t } = useTranslation()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button
        ref={anchor}
        className="track-effects-trigger"
        aria-pressed={active}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        <span className="track-effects-symbol" aria-hidden="true">
          fx
        </span>
        <span className="track-effects-label">
          <span>{t('waveform.effects')}</span>
          <Icon name="chevron" size={10} />
        </span>
      </button>
      {open && (
        <TrackControlPopover
          anchor={anchor}
          label={t('waveform.effects')}
          role="menu"
          onClose={close}
        >
          <button
            className="track-effect-item"
            role="menuitemcheckbox"
            aria-checked={normalized}
            onClick={onToggleNormalize}
          >
            <span>{t('waveform.normalize')}</span>
            {normalized && <Icon name="check" size={14} />}
          </button>
        </TrackControlPopover>
      )}
    </>
  )
}
