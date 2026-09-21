import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n/useTranslation'

export function RedactionContextMenu({
  x,
  y,
  onEdit,
  onClose,
  label,
}: {
  x: number
  y: number
  onEdit(): void
  onClose(): void
  label?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [point, setPoint] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect()
    setPoint({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
    ref.current?.querySelector('button')?.focus()
  }, [x, y])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="redaction-context-menu"
      style={{ position: 'fixed', ...point }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          onClose()
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          ref.current?.querySelector('button')?.focus()
        }
      }}
    >
      <button type="button" role="menuitem" onClick={onEdit}>
        {label ?? t('waveform.editCrossfadeMenu')}
      </button>
    </div>,
    document.body,
  )
}
