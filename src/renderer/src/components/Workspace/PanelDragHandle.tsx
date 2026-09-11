import { Icon } from '../ui/Icon'
import type { PointerEventHandler } from 'react'

export function PanelDragHandle({
  label,
  onPointerDown,
}: {
  label: string
  onPointerDown: PointerEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      className="workspace-handle"
      aria-label={`Drag ${label} panel`}
      title={`Drag ${label} panel`}
      onPointerDown={onPointerDown}
    >
      <Icon name="grip" />
    </button>
  )
}
