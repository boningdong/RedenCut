import { useTranslation } from '../../i18n/useTranslation'
import { publicMessage } from '../../i18n/messages'
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
import {
  getPanelDropGeometry,
  TRANSPORT_DROP_SLOT_HEIGHT,
  type PanelDropGeometry,
} from './PanelDropGeometry'
import { Icon } from '../ui/Icon'
import './workspace.css'

const PANEL_GAP = 13

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
  transcript: ReactNode | ((controls: ReactNode) => ReactNode)
  audio: ReactNode | ((controls: ReactNode) => ReactNode)
  transport: ReactNode | ((controls: ReactNode) => ReactNode)
}) {
  const { t } = useTranslation()
  const { layout, warning, error, errorKind, hydrate, updateLayout, retrySave, resetLayout } =
    useWorkspaceStore()
  const root = useRef<HTMLDivElement>(null)
  const restore = useRef<(() => void) | null>(null)
  const cancelInteraction = useRef<(() => void) | null>(null)
  const pendingPositions = useRef<Map<HTMLElement, number> | null>(null)
  const animations = useRef<Animation[]>([])
  const [height, setHeight] = useState(400)
  const [previewRatio, setPreviewRatio] = useState<number | null>(null)
  const [drag, setDrag] = useState<{
    panel: WorkspacePanelId
    target: PanelDropGeometry | null
    x: number
    y: number
  } | null>(null)
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
    let observedHeight = element.clientHeight
    const observer = new ResizeObserver(() => {
      const nextHeight = element.clientHeight
      if (nextHeight === observedHeight) return
      observedHeight = nextHeight
      cancelInteraction.current?.()
      setHeight(nextHeight)
    })
    observer.observe(element)
    setHeight(observedHeight)
    return () => observer.disconnect()
  }, [])
  useEffect(
    () => () => {
      cancelInteraction.current?.()
      animations.current.forEach((animation) => animation.cancel())
    },
    [],
  )
  useLayoutEffect(() => {
    // Hydration or another layout command invalidates the geometry of an active gesture.
    cancelInteraction.current?.()
    restore.current?.()
    restore.current = null
    const positions = pendingPositions.current
    pendingPositions.current = null
    if (!positions || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    for (const [element, top] of positions) {
      const offset = top - element.getBoundingClientRect().top
      if (offset && element.animate)
        animations.current.push(
          element.animate(
            [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
            { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)' },
          ),
        )
    }
  }, [layout])

  const commit = (next: WorkspaceLayout) => {
    restore.current = captureEditingSurface(root.current)
    if (
      next.contentOrder[0] !== layout.contentOrder[0] ||
      next.transportPosition !== layout.transportPosition
    ) {
      pendingPositions.current = new Map(
        Array.from(root.current?.querySelectorAll<HTMLElement>('[data-workspace-panel]') ?? []).map(
          (element) => [element, element.getBoundingClientRect().top],
        ),
      )
    }
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
    animations.current.forEach((animation) => animation.cancel())
    const bounds = root.current?.getBoundingClientRect()
    if (!bounds) return
    const other = layout.contentOrder.find((id) => id !== panel)!
    const destination = root.current
      ?.querySelector<HTMLElement>(`[data-workspace-panel="${other}"]`)
      ?.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    let activated = false
    const targetAt = (next: PointerEvent) =>
      getPanelDropGeometry(panel, layout, bounds, destination, next.clientX, next.clientY)
    startInteraction(
      event,
      (next) => {
        if (!activated && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 16) return
        activated = true
        setDrag({
          panel,
          target: targetAt(next),
          x: next.clientX - bounds.left,
          y: next.clientY - bounds.top,
        })
      },
      (cancelled, next) => {
        const target = activated && next ? targetAt(next) : null
        setDrag(null)
        if (!cancelled && target)
          commit(
            applyWorkspaceDrop(
              useWorkspaceStore.getState().layout,
              panelDropTarget(panel, target.lower),
            ),
          )
      },
    )
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
    return (
      <WorkspacePanel
        key={id}
        id={id}
        style={
          id === 'transport'
            ? { height: WORKSPACE_PANELS.transport.minimumHeight, flexShrink: 0 }
            : ({
                '--workspace-panel-height': `${(id === 'transcript' ? ratio : 1 - ratio) * contentHeight}px`,
                minHeight: 0,
              } as CSSProperties)
        }
        onDrag={(event) => startDrag(id, event)}
        commands={
          id === 'transport' ? (
            <button
              className="workspace-command workspace-reset"
              aria-label={t('workspace.reset')}
              title={t('workspace.reset')}
              onClick={() => {
                restore.current = captureEditingSurface(root.current)
                resetLayout()
              }}
            >
              ↺
            </button>
          ) : undefined
        }
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
      aria-label={t('workspace.editor')}
      style={{ '--workspace-panel-gap': `${PANEL_GAP}px` } as CSSProperties}
    >
      {(error || warning) && (
        <div
          className="workspace-settings"
          data-workspace-controls
          onKeyDown={(event) => {
            if (!event.metaKey && !event.ctrlKey) event.stopPropagation()
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span role="status">{publicMessage(t, (error ?? warning)!)}</span>
          {error && errorKind === 'save' && (
            <button className="workspace-command" onClick={() => void retrySave()}>
              {t('workspace.retrySave')}
            </button>
          )}
        </div>
      )}
      <div
        className="workspace-regions"
        ref={root}
        data-drag-panel={drag?.panel}
        data-transport-position={layout.transportPosition}
        style={
          { '--transport-drop-slot-height': `${TRANSPORT_DROP_SLOT_HEIGHT}px` } as CSSProperties
        }
      >
        {panels}
        {drag && (
          <div className="workspace-drop-overlay" aria-live="polite">
            {(drag.panel === 'transport' || drag.target) && (
              <PanelDropIndicator
                target={panelDropTarget(
                  drag.panel,
                  drag.panel === 'transport'
                    ? layout.transportPosition === 'top'
                    : drag.target!.lower,
                )}
                panel={drag.panel}
                lower={
                  drag.panel === 'transport'
                    ? layout.transportPosition === 'top'
                    : drag.target!.lower
                }
                active={drag.target !== null}
                style={drag.panel === 'transport' ? undefined : drag.target?.style}
              />
            )}
            <div
              className="workspace-drag-label"
              aria-hidden="true"
              style={{
                left: Math.max(8, Math.min(drag.x + 18, (root.current?.clientWidth ?? 300) - 190)),
                top: drag.y + 16,
              }}
            >
              <span className="workspace-drag-dots">
                <Icon name="grip" />
              </span>
              {t(WORKSPACE_PANELS[drag.panel].labelKey)}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
