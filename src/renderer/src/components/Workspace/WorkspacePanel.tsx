import type { ReactNode, PointerEventHandler, CSSProperties } from 'react'
import type { WorkspacePanelId } from '../../workspace/workspaceLayout.types'
import { WORKSPACE_PANELS } from '../../workspace/workspaceLayout'
import { PanelDragHandle } from './PanelDragHandle'

export function WorkspacePanel({
  id,
  children,
  style,
  moveLabel,
  onMove,
  onDrag,
}: {
  id: WorkspacePanelId
  children: ReactNode
  style?: CSSProperties
  moveLabel: string
  onMove: () => void
  onDrag: PointerEventHandler<HTMLButtonElement>
}) {
  const { label } = WORKSPACE_PANELS[id]
  return (
    <section
      aria-label={`${label} panel`}
      data-workspace-panel={id}
      className={`workspace-panel workspace-panel-${id}`}
      style={style}
    >
      <div
        className="workspace-panel-header"
        data-workspace-controls
        onKeyDown={(event) => {
          if (!event.metaKey && !event.ctrlKey) event.stopPropagation()
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <PanelDragHandle label={label} onPointerDown={onDrag} />
        <span>{label}</span>
        <button className="workspace-command" onClick={onMove}>
          {moveLabel}
        </button>
      </div>
      <div className="workspace-panel-content">{children}</div>
    </section>
  )
}
