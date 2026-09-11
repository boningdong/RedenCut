import type { ReactNode, PointerEventHandler, CSSProperties } from 'react'
import type { WorkspacePanelId } from '../../workspace/workspaceLayout.types'
import { WORKSPACE_PANELS } from '../../workspace/workspaceLayout'
import { PanelDragHandle } from './PanelDragHandle'

export function WorkspacePanel({
  id,
  children,
  style,
  onDrag,
  commands,
}: {
  commands?: ReactNode
  id: WorkspacePanelId
  children: ReactNode | ((controls: ReactNode) => ReactNode)
  style?: CSSProperties
  onDrag: PointerEventHandler<HTMLButtonElement>
}) {
  const { label } = WORKSPACE_PANELS[id]
  const controls = (
    <div
      className="workspace-panel-controls"
      data-workspace-controls
      onKeyDown={(event) => {
        if (!event.metaKey && !event.ctrlKey) event.stopPropagation()
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <PanelDragHandle label={label} onPointerDown={onDrag} />
      {commands}
    </div>
  )
  return (
    <section
      aria-label={`${label} panel`}
      data-workspace-panel={id}
      className={`workspace-panel workspace-panel-${id}`}
      style={style}
    >
      <div className="workspace-panel-content">
        {typeof children === 'function' ? (
          children(controls)
        ) : (
          <>
            {controls}
            {children}
          </>
        )}
      </div>
    </section>
  )
}
