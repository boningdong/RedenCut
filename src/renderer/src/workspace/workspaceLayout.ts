import type { WorkspaceLayout } from '@shared/workspaceLayout.types'
import type { WorkspaceDropTarget, WorkspacePanelId } from './workspaceLayout.types'

export const WORKSPACE_PANELS = {
  transcript: { label: 'Transcript', minimumHeight: 120, placement: 'content' },
  audio: { label: 'Audio', minimumHeight: 120, placement: 'content' },
  transport: { label: 'Transport', minimumHeight: 80, placement: 'strip' },
} as const

export function constrainTranscriptRatio(ratio: number, height: number): number {
  const minimum = Math.min(0.5, WORKSPACE_PANELS.transcript.minimumHeight / Math.max(1, height))
  const maximum = Math.max(0.5, 1 - WORKSPACE_PANELS.audio.minimumHeight / Math.max(1, height))
  return Math.max(minimum, Math.min(maximum, Math.max(0.1, Math.min(0.9, ratio))))
}

export function panelDropTarget(panel: WorkspacePanelId, lower: boolean): WorkspaceDropTarget {
  return WORKSPACE_PANELS[panel].placement === 'strip'
    ? { kind: 'transport-position', position: lower ? 'bottom' : 'top' }
    : {
        kind: 'content-order',
        first: lower
          ? panel === 'audio'
            ? 'transcript'
            : 'audio'
          : (panel as 'audio' | 'transcript'),
      }
}

export function applyWorkspaceDrop(
  layout: WorkspaceLayout,
  target: WorkspaceDropTarget,
): WorkspaceLayout {
  return target.kind === 'transport-position'
    ? { ...layout, transportPosition: target.position }
    : {
        ...layout,
        contentOrder:
          target.first === 'transcript' ? ['transcript', 'audio'] : ['audio', 'transcript'],
      }
}
