import type { CSSProperties } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
import { WORKSPACE_PANELS } from '../../workspace/workspaceLayout'
import type { WorkspacePanelId } from '../../workspace/workspaceLayout.types'
import type { WorkspaceDropTarget } from '../../workspace/workspaceLayout.types'

export function PanelDropIndicator({
  target,
  panel,
  lower,
  active,
  style,
}: {
  panel: WorkspacePanelId
  target: WorkspaceDropTarget
  lower: boolean
  active: boolean
  style?: CSSProperties
}) {
  const { t } = useTranslation()
  const label =
    target.kind === 'transport-position'
      ? t(target.position === 'top' ? 'workspace.transportTop' : 'workspace.transportBottom')
      : t(lower ? 'workspace.moveBelow' : 'workspace.moveAbove', {
          label: t(WORKSPACE_PANELS[panel].labelKey),
        })
  return (
    <div
      className={`workspace-drop-target ${target.kind === 'transport-position' ? 'is-transport' : ''}`}
      style={style}
      data-workspace-drop={lower ? 'lower' : 'upper'}
      data-active={active}
    >
      <span className="workspace-drop-caption">
        {target.kind === 'transport-position' ? (
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="3" width="16" height="18" rx="3" />
            <path d={lower ? 'M4 15h16' : 'M4 9h16'} />
          </svg>
        ) : (
          <Icon name="arrow" size={14} style={{ transform: `rotate(${lower ? 90 : -90}deg)` }} />
        )}
        {label}
        {target.kind === 'transport-position' && (
          <small>{t(active ? 'workspace.releaseToDock' : 'workspace.dragToDock')}</small>
        )}
      </span>
    </div>
  )
}
