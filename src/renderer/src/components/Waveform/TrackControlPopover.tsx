import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPopover } from './UseAnchoredPopover'

export function TrackControlPopover({
  anchor,
  label,
  role = 'dialog',
  onClose,
  onCancel,
  children,
}: {
  anchor: RefObject<HTMLButtonElement | null>
  label: string
  role?: 'dialog' | 'menu'
  onClose(): void
  onCancel?(): void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const position = useAnchoredPopover(anchor, panel, onClose)
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        onClose()
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [anchor, onClose])
  return createPortal(
    <div
      ref={panel}
      role={role}
      aria-label={label}
      className="track-control-popover"
      style={{ position: 'fixed', ...position }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          ;(onCancel ?? onClose)()
          anchor.current?.focus()
        }
        if (role === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          panel.current?.querySelector('button')?.focus()
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node) &&
          event.relatedTarget !== anchor.current
        )
          onClose()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
