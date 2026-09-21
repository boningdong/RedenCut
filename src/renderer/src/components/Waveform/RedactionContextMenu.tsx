import { useTranslation } from '../../i18n/useTranslation'
import { EditorContextMenu } from '../ui/EditorContextMenu'

export function RedactionContextMenu({
  x,
  y,
  onEdit,
  onRemove,
  onClose,
}: {
  x: number
  y: number
  onEdit(): void
  onRemove(): void
  onClose(): void
}) {
  const { t } = useTranslation()
  return (
    <EditorContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        { id: 'crossfade', label: t('waveform.editCrossfadeMenu'), action: onEdit },
        { id: 'remove', label: t('waveform.removeRedact'), separator: true, action: onRemove },
      ]}
    />
  )
}
