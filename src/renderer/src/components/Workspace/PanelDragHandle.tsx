import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
import type { PointerEventHandler } from 'react'

export function PanelDragHandle({
  label,
  onPointerDown,
}: {
  label: string
  onPointerDown: PointerEventHandler<HTMLButtonElement>
}) {
  const { t } = useTranslation()
  return (
    <button
      className="workspace-handle"
      aria-label={t('workspace.drag', { label })}
      title={t('workspace.drag', { label })}
      onPointerDown={onPointerDown}
    >
      <Icon name="grip" />
    </button>
  )
}
