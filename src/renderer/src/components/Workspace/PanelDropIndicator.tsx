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
  const label =
    target.kind === 'transport-position'
      ? `Transport at ${target.position}`
      : `${target.first === 'audio' ? 'Audio' : 'Transcript'} first`
  return (
    <div
      className={`workspace-drop-target ${lower ? 'is-lower' : 'is-upper'} ${active ? 'is-active' : ''}`}
      data-workspace-drop={lower ? 'lower' : 'upper'}
    >
      {label}
    </div>
  )
}
