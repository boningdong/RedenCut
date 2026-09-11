import { useTranslation } from '../../i18n/useTranslation'
import type { WorkspaceDropTarget } from '../../workspace/workspaceLayout.types'

export function PanelDropIndicator({
  target,
  lower,
  active,
}: {
  target: WorkspaceDropTarget
  lower: boolean
  active: boolean
}) {
  const { t } = useTranslation()
  const label =
    target.kind === 'transport-position'
      ? t(target.position === 'top' ? 'workspace.transportTop' : 'workspace.transportBottom')
      : t(target.first === 'audio' ? 'workspace.audioFirst' : 'workspace.transcriptFirst')
  return (
    <div
      className={`workspace-drop-target ${lower ? 'is-lower' : 'is-upper'} ${active ? 'is-active' : ''}`}
      data-workspace-drop={lower ? 'lower' : 'upper'}
    >
      {label}
    </div>
  )
}
