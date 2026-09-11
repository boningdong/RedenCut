import { useTranslation } from '../../i18n/useTranslation'
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
  const { t } = useTranslation()
  return (
    <div
      className="workspace-divider"
      role="separator"
      aria-label={t('workspace.resize')}
      aria-orientation="horizontal"
      aria-valuemin={Math.round(minimum * 100)}
      aria-valuemax={Math.round(maximum * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={t('workspace.ratio', { percent: Math.round(ratio * 100) })}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
