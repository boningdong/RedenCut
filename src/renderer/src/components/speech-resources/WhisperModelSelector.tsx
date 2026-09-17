import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useResourcesStore } from '../../stores/resources.store'
import { Icon } from '../ui/Icon'

export function WhisperModelSelector({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const store = useResourcesStore()
  const models = store.snapshot?.whisperModels ?? []
  const selected = models.find((m) => m.id === store.snapshot?.selectedWhisperModelId)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  useLayoutEffect(() => {
    if (!open) return
    const reposition = () => {
      if (!root.current || !menu.current) return
      const anchor = root.current.getBoundingClientRect()
      const bounds = root.current.closest('dialog')?.getBoundingClientRect()
      const popup = menu.current.getBoundingClientRect()
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 12
      setPosition({
        left: Math.max(12, anchor.right - popup.width),
        top:
          anchor.bottom + 7 + popup.height <= bottom
            ? anchor.bottom + 7
            : Math.max((bounds?.top ?? 0) + 12, anchor.top - popup.height - 7),
      })
    }
    reposition()
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus({ preventScroll: true })
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  if (!selected) return null
  return (
    <div
      className="whisper-selector"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus({ preventScroll: true })
        }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const buttons = [
            ...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
          ]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus({ preventScroll: true })
        }
      }}
    >
      <span>{t(`settings.whisperModels.${selected.variant}`)}</span>
      {selected.recommended && <span className="badge">{t('settings.recommended')}</span>}
      <button
        ref={trigger}
        className="whisper-change"
        aria-label={t('settings.changeWhisper')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || store.pending}
        onClick={() => setOpen(!open)}
      >
        {t('settings.changeModel')}
        <Icon name="chevron" />
      </button>
      {open && (
        <div
          ref={menu}
          style={position}
          className="whisper-model-menu"
          role="menu"
          aria-label={t('settings.whisperModel')}
        >
          {models.map((model) => {
            const resource = store.snapshot?.resources.find((r) => r.id === model.id)
            const status = resource?.status ?? 'missing'
            return (
              <button
                key={model.id}
                role="menuitemradio"
                aria-checked={selected.id === model.id}
                disabled={disabled || store.pending}
                onClick={() => {
                  setOpen(false)
                  trigger.current?.focus({ preventScroll: true })
                  void store.selectWhisper(model.id)
                }}
              >
                <span className="whisper-option-check">
                  {selected.id === model.id && <Icon name="check" />}
                </span>
                <span className="whisper-option-name">
                  {t(`settings.whisperModels.${model.variant}`)}
                  <small>{t(`settings.whisperHelp.${model.variant}`)}</small>
                </span>
                <span className={status === 'ready' ? 'ready' : 'pending'}>
                  {t(
                    status === 'ready'
                      ? 'settings.downloaded'
                      : status === 'missing'
                        ? 'settings.notDownloaded'
                        : `settings.${status}`,
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
