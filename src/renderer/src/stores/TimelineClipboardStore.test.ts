import { beforeEach, describe, expect, it } from 'vitest'
import type { Clip } from '@shared/project.types'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { useEditorStore } from './editor.store'
import { useTimelineClipboardStore } from './TimelineClipboardStore'
import { useTimelineStore } from './timeline.store'

const clipboardClip: Clip = {
  id: 'clip-a',
  trackId: 'track-a',
  audioSourceId: '00000000-0000-4000-8000-000000000001' as never,
  sourceStart: 1,
  sourceEnd: 3,
  outputStart: 4,
  gain: 1,
  muted: false,
  effects: [],
}

function session(workspaceToken: string, revision: number): RendererSession {
  return {
    workspaceToken: workspaceToken as WorkspaceToken,
    revision,
    workspace: { kind: 'temporary', displayName: 'Project', portable: true },
    sources: [],
    speechAnalyses: [],
    draft: {
      tracks: [],
      export: { format: 'mp3', targetLUFS: -16, truePeakDbTP: -1.5, sampleRate: 48_000 },
    },
  }
}

function fillClipboard(workspaceToken: WorkspaceToken | null): void {
  useTimelineClipboardStore.getState().setContents({
    workspaceToken,
    anchorClipId: clipboardClip.id,
    sourceAnchorTrackId: clipboardClip.trackId,
    clips: [{ clip: clipboardClip, sourceTrackId: clipboardClip.trackId, trackOffset: 0 }],
  })
}

describe('timeline clipboard project lifecycle', () => {
  beforeEach(() => {
    useTimelineClipboardStore.getState().clear()
    useEditorStore.getState().reset()
    useTimelineStore.getState().reset()
  })

  it('retains copied clips when the same project advances to a saved revision', () => {
    useTimelineStore.getState().loadFromProject([], [])
    useEditorStore.getState().loadSession(session('workspace-a', 1))
    fillClipboard('workspace-a' as WorkspaceToken)

    useEditorStore.getState().loadSession(session('workspace-a', 2))

    expect(useTimelineClipboardStore.getState().contents?.anchorClipId).toBe('clip-a')
  })

  it('clears copied clips when a project replacement reuses the same source set', () => {
    useTimelineStore.getState().loadFromProject([], [])
    fillClipboard('workspace-a' as WorkspaceToken)

    useTimelineStore.getState().loadFromProject([], [])

    expect(useTimelineClipboardStore.getState().contents).toBeNull()
  })

  it('clears copied clips when the timeline project resets', () => {
    useTimelineStore.getState().loadFromProject([], [])
    fillClipboard('workspace-a' as WorkspaceToken)

    useTimelineStore.getState().reset()

    expect(useTimelineClipboardStore.getState().contents).toBeNull()
  })
})
