import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { WorkspaceLayout } from '@shared/workspaceLayout.types'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  applyWorkspaceDrop,
  constrainTranscriptRatio,
  panelDropTarget,
  WORKSPACE_PANELS,
} from '../../workspace/workspaceLayout'
import type { WorkspacePanelId } from '../../workspace/workspaceLayout.types'
import { WorkspacePanel } from './WorkspacePanel'
import { PanelDivider } from './PanelDivider'
import { PanelDropIndicator } from './PanelDropIndicator'
import './workspace.css'

const PANEL_GAP = 8

function captureEditingSurface(root: HTMLElement | null): () => void {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  const focus = selection?.focusNode
  const anchorOffset = selection?.anchorOffset ?? 0
  const focusOffset = selection?.focusOffset ?? 0
  const restoreSelection = anchor && focus && root?.contains(anchor) && root.contains(focus)
  const scroll = Array.from(root?.querySelectorAll<HTMLElement>('*') ?? [])
    .filter((node) => node.scrollTop || node.scrollLeft)
    .map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }))
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return () => {
    if (focused?.isConnected && document.activeElement !== focused)
      focused.focus({ preventScroll: true })
    if (restoreSelection && anchor.isConnected && focus.isConnected)
      selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
    scroll.forEach(({ node, top, left }) => {
      node.scrollTop = top
      node.scrollLeft = left
    })
  }
}

export function EditorWorkspace({
  transcript,
  audio,
  transport,
}: {
  transcript: ReactNode
  audio: ReactNode
  transport: ReactNode
}) {
  const {
    layout,
    hydrated,
    saving,
    warning,
    error,
    errorKind,
    hydrate,
    updateLayout,
    retrySave,
    resetLayout,
  } = useWorkspaceStore()
  const root = useRef<HTMLDivElement>(null)
  const restore = useRef<(() => void) | null>(null)
  const cancelInteraction = useRef<(() => void) | null>(null)
  const [height, setHeight] = useState(400)
  const [previewRatio, setPreviewRatio] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ panel: WorkspacePanelId; lower: boolean | null } | null>(null)
  const contentHeight = Math.max(
    1,
    height - WORKSPACE_PANELS.transport.minimumHeight - 2 * PANEL_GAP,
  )
  const ratio = constrainTranscriptRatio(previewRatio ?? layout.transcriptRatio, contentHeight)

  useEffect(() => {
    void hydrate()
  }, [hydrate])
  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])
  useEffect(() => () => cancelInteraction.current?.(), [])
  useLayoutEffect(() => {
    // Hydration or another layout command invalidates the geometry of an active gesture.
    cancelInteraction.current?.()
    restore.current?.()
    restore.current = null
  }, [layout])

  const commit = (next: WorkspaceLayout) => {
    restore.current = captureEditingSurface(root.current)
    updateLayout(next)
  }

  const startInteraction = (
    event: ReactPointerEvent,
    move: (event: PointerEvent) => void,
    finish: (cancelled: boolean, event?: PointerEvent) => void,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    cancelInteraction.current?.()
    const pointerId = event.pointerId
    const onMove = (next: PointerEvent) => {
      if (next.pointerId === pointerId) move(next)
    }
    const end = (cancelled: boolean, next?: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey, true)
      cancelInteraction.current = null
      finish(cancelled, next)
    }
    const onUp = (next: PointerEvent) => {
      if (next.pointerId === pointerId) end(false, next)
    }
    const onCancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) end(true)
    }
    const onBlur = () => end(true)
    const onKey = (next: KeyboardEvent) => {
      if (next.key === 'Escape') {
        next.preventDefault()
        next.stopImmediatePropagation()
        end(true)
      }
    }
    cancelInteraction.current = () => end(true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey, true)
  }

  const startDrag = (panel: WorkspacePanelId, event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const targetAt = (next: PointerEvent): boolean | null => {
      const bounds = root.current?.getBoundingClientRect()
      if (
        !bounds ||
        next.clientX < bounds.left ||
        next.clientX > bounds.right ||
        next.clientY < bounds.top ||
        next.clientY > bounds.bottom
      )
        return null
      const offset = next.clientY - bounds.top
      if (offset <= 52) return false
      if (offset >= bounds.height - 52) return true
      return null
    }
    startInteraction(
      event,
      (next) => setDrag({ panel, lower: targetAt(next) }),
      (cancelled, next) => {
        const lower = next ? targetAt(next) : null
        setDrag(null)
        if (!cancelled && lower !== null)
          commit(
            applyWorkspaceDrop(useWorkspaceStore.getState().layout, panelDropTarget(panel, lower)),
          )
      },
    )
    setDrag({ panel, lower: null })
  }

  const startResize = (event: ReactPointerEvent) => {
    const start = event.clientY
    const initial = ratio
    let nextRatio = initial
    const calculate = (next: PointerEvent) =>
      constrainTranscriptRatio(
        initial +
          ((next.clientY - start) / contentHeight) *
            (layout.contentOrder[0] === 'transcript' ? 1 : -1),
        contentHeight,
      )
    startInteraction(
      event,
      (next) => {
        nextRatio = calculate(next)
        setPreviewRatio(nextRatio)
      },
      (cancelled, next) => {
        setPreviewRatio(null)
        if (!cancelled && next) {
          nextRatio = calculate(next)
          if (nextRatio !== initial)
            commit({ ...useWorkspaceStore.getState().layout, transcriptRatio: nextRatio })
        }
      },
    )
  }

  const content = { transcript, audio, transport }
  const panel = (id: WorkspacePanelId) => {
    const lower =
      id === 'transport' ? layout.transportPosition === 'top' : layout.contentOrder[0] === id
    return (
      <WorkspacePanel
        key={id}
        id={id}
        style={
          id === 'transport'
            ? { height: WORKSPACE_PANELS.transport.minimumHeight, flexShrink: 0 }
            : {
                flex: `0 0 ${(id === 'transcript' ? ratio : 1 - ratio) * contentHeight}px`,
                minHeight: 0,
              }
        }
        moveLabel={`Move ${WORKSPACE_PANELS[id].label} ${lower ? 'down' : 'up'}`}
        onMove={() => commit(applyWorkspaceDrop(layout, panelDropTarget(id, lower)))}
        onDrag={(event) => startDrag(id, event)}
      >
        {content[id]}
      </WorkspacePanel>
    )
  }
  const panels = [
    panel(layout.contentOrder[0]),
    <PanelDivider
      key="divider"
      ratio={ratio}
      minimum={constrainTranscriptRatio(0.1, contentHeight)}
      maximum={constrainTranscriptRatio(0.9, contentHeight)}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey) return
        event.stopPropagation()
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const direction = layout.contentOrder[0] === 'transcript' ? 1 : -1
        const next =
          event.key === 'Home'
            ? 0.1
            : event.key === 'End'
              ? 0.9
              : ratio + (event.key === 'ArrowDown' ? 0.05 : -0.05) * direction
        commit({ ...layout, transcriptRatio: constrainTranscriptRatio(next, contentHeight) })
      }}
    />,
    panel(layout.contentOrder[1]),
  ]
  if (layout.transportPosition === 'top') panels.unshift(panel('transport'))
  else panels.push(panel('transport'))

  return (
    <main
      className="editor-workspace"
      aria-label="Editor workspace"
      style={{ '--workspace-panel-gap': `${PANEL_GAP}px` } as CSSProperties}
    >
      <div
        className="workspace-settings"
        data-workspace-controls
        onKeyDown={(event) => {
          if (!event.metaKey && !event.ctrlKey) event.stopPropagation()
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span role="status">
          {error ?? warning ?? (!hydrated ? 'Loading layout…' : saving ? 'Saving layout…' : '')}
        </span>
        {error && errorKind === 'save' && (
          <button className="workspace-command" onClick={() => void retrySave()}>
            Retry layout save
          </button>
        )}
        <button
          className="workspace-command"
          onClick={() => {
            restore.current = captureEditingSurface(root.current)
            resetLayout()
          }}
        >
          Reset layout
        </button>
      </div>
      <div className="workspace-regions" ref={root}>
        {panels}
        {drag && (
          <div className="workspace-drop-overlay" aria-live="polite">
            <PanelDropIndicator
              target={panelDropTarget(drag.panel, false)}
              lower={false}
              active={drag.lower === false}
            />
            <PanelDropIndicator
              target={panelDropTarget(drag.panel, true)}
              lower
              active={drag.lower === true}
            />
          </div>
        )}
      </div>
    </main>
  )
}
