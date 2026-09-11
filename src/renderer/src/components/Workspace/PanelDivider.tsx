import type { KeyboardEventHandler, PointerEventHandler } from 'react'

export function PanelDivider({
  ratio,
  minimum,
  maximum,
  onPointerDown,
  onKeyDown,
}: {
  ratio: number
  minimum: number
  maximum: number
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onKeyDown: KeyboardEventHandler<HTMLDivElement>
}) {
  return (
    <div
      className="workspace-divider"
      role="separator"
      aria-label="Resize transcript and audio panels"
      aria-orientation="horizontal"
      aria-valuemin={Math.round(minimum * 100)}
      aria-valuemax={Math.round(maximum * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`Transcript ${Math.round(ratio * 100)} percent`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
