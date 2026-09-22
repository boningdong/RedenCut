import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { TrackControlPopover } from './TrackControlPopover'

export function TrackLevelControl({
  kind,
  name,
  value,
  onCommit,
  onPreview,
  onCancelPreview,
}: {
  kind: 'volume' | 'gain'
  name: string
  value: number
  onCommit(value: number): void
  onPreview?(value: number): void
  onCancelPreview?(): void
}) {
  const { t } = useTranslation()
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const [typed, setTyped] = useState(String(value))
  const typedRef = useRef(String(value))
  const typedDirty = useRef(false)
  const previewing = useRef(false)
  const restorePreviewRef = useRef(onCancelPreview)
  restorePreviewRef.current = onCancelPreview
  const restorePreview = useCallback(() => {
    if (!previewing.current) return
    previewing.current = false
    restorePreviewRef.current?.()
  }, [])
  useEffect(() => restorePreview, [restorePreview])
  const commitTyped = useCallback(() => {
    if (!typedDirty.current) return
    typedDirty.current = false
    const next = typedRef.current.trim() ? Number(typedRef.current) : NaN
    if (Number.isFinite(next) && next >= -24 && next <= 24) {
      draftRef.current = next
      setDraft(next)
      setTyped(String(next))
      if (next !== value) onCommit(next)
    } else {
      draftRef.current = value
      setDraft(value)
      setTyped(String(value))
    }
  }, [value, onCommit])
  const close = useCallback(() => {
    commitTyped()
    restorePreview()
    setOpen(false)
  }, [commitTyped, restorePreview])
  const cancel = useCallback(() => {
    typedDirty.current = false
    restorePreview()
    setOpen(false)
  }, [restorePreview])
  const volume = kind === 'volume'
  const min = volume ? 0 : -24,
    max = volume ? 1 : 24
  const label = t(volume ? 'waveform.volumeName' : 'waveform.gainName', { name })
  const format = (level: number) =>
    volume ? `${Math.round(level * 100)}%` : `${level > 0 ? '+' : ''}${level} dB`
  const commit = () => {
    if (draftRef.current !== value) onCommit(draftRef.current)
    previewing.current = false
  }
  return (
    <>
      <button
        ref={anchor}
        className="track-level-control"
        data-kind={kind}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ '--level': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setDraft(value)
          draftRef.current = value
          setTyped(String(value))
          typedRef.current = String(value)
          typedDirty.current = false
          setOpen(!open)
        }}
      >
        <span>{t(volume ? 'waveform.volumeShort' : 'waveform.gain')}</span>
        <span>{format(value)}</span>
      </button>
      {open && (
        <TrackControlPopover anchor={anchor} label={label} onClose={close} onCancel={cancel}>
          <div className="track-level-heading">
            <span>{label}</span>
            <output>{format(draft)}</output>
          </div>
          {!volume && (
            <label className="track-gain-entry">
              <input
                type="number"
                aria-label={label}
                min={-24}
                max={24}
                step="any"
                value={typed}
                onChange={(event) => {
                  typedRef.current = event.currentTarget.value
                  typedDirty.current = true
                  setTyped(typedRef.current)
                }}
                onBlur={commitTyped}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitTyped()
                  }
                }}
              />
              <span>dB</span>
            </label>
          )}
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
              setTyped(String(draftRef.current))
              previewing.current = true
              onPreview?.(draftRef.current)
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture?.(event.pointerId)}
            onPointerUp={commit}
            onPointerCancel={() => {
              restorePreview()
              draftRef.current = value
              setDraft(value)
              setTyped(String(value))
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
                setTyped(String(next))
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
