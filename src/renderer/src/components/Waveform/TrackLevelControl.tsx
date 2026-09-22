import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { TrackControlPopover } from './TrackControlPopover'

export function TrackLevelControl({
  kind,
  name,
  value,
  onCommit,
}: {
  kind: 'volume' | 'gain'
  name: string
  value: number
  onCommit(value: number): void
}) {
  const { t } = useTranslation()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const close = useCallback(() => setOpen(false), [])
  const volume = kind === 'volume'
  const min = volume ? 0 : -24,
    max = volume ? 1 : 24
  const label = t(volume ? 'waveform.volumeName' : 'waveform.gainName', { name })
  const format = (level: number) =>
    volume ? `${Math.round(level * 100)}%` : `${level > 0 ? '+' : ''}${level} dB`
  const commit = () => {
    if (draftRef.current !== value) onCommit(draftRef.current)
  }
  return (
    <>
      <button
        ref={anchor}
        className="track-level-control"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ '--level': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onClick={() => {
          setDraft(value)
          draftRef.current = value
          setOpen(!open)
        }}
      >
        <span>{t(volume ? 'waveform.volumeShort' : 'waveform.gain')}</span>
        <span>{format(value)}</span>
      </button>
      {open && (
        <TrackControlPopover anchor={anchor} label={label} onClose={close}>
          <div className="track-level-heading">
            <span>{label}</span>
            <output>{format(draft)}</output>
          </div>
          <input
            type="range"
            aria-label={label}
            aria-valuetext={format(draft)}
            min={min}
            max={max}
            step={volume ? 0.01 : 0.5}
            value={draft}
            onChange={(event) => {
              draftRef.current = event.currentTarget.valueAsNumber
              setDraft(draftRef.current)
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture?.(event.pointerId)}
            onPointerUp={commit}
            onPointerCancel={() => {
              draftRef.current = value
              setDraft(value)
            }}
            onKeyUp={(event) => {
              if (
                [
                  'ArrowLeft',
                  'ArrowRight',
                  'ArrowUp',
                  'ArrowDown',
                  'Home',
                  'End',
                  'PageUp',
                  'PageDown',
                ].includes(event.key)
              )
                commit()
            }}
          />
          <div className="track-level-heading">
            <span>{format(min)}</span>
            <button
              onClick={() => {
                const next = volume ? 1 : 0
                setDraft(next)
                draftRef.current = next
                if (next !== value) onCommit(next)
              }}
            >
              {t('waveform.resetLevel')}
            </button>
            <span>{format(max)}</span>
          </div>
        </TrackControlPopover>
      )}
    </>
  )
}
