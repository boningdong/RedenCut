import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  id: string
  label: string
  disabled?: boolean
  separator?: boolean
  action(): void
}

export function EditorContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  const [point, setPoint] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect()
    setPoint({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    ;(first ?? ref.current)?.focus({ preventScroll: true })
  }, [x, y])
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const scroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [onClose])
  const dismiss = () => {
    onClose()
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
  }
  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="editor-context-menu"
      style={{ position: 'fixed', ...point }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          dismiss()
          return
        }
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
        )
        if (!buttons.length) return
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : e.key === 'ArrowDown'
                ? (index + 1) % buttons.length
                : e.key === 'ArrowUp'
                  ? (index - 1 + buttons.length) % buttons.length
                  : null
        if (next !== null) {
          e.preventDefault()
          buttons[next].focus()
        }
      }}
    >
      {items.map((item) => (
        <div key={item.id} role="none">
          {item.separator && <div role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              dismiss()
              item.action()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
