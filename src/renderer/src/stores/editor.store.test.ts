import { beforeEach, describe, expect, it } from 'vitest'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { useEditorStore } from './editor.store'

function session(revision: number): RendererSession {
  return {
    workspaceToken: 'workspace-token' as WorkspaceToken,
    revision,
    workspace: { kind: 'temporary', displayName: 'Untitled', portable: true },
    sources: [],
    draft: {
      tracks: [],
      export: { format: 'mp3', targetLUFS: -16, truePeakDbTP: -1.5, sampleRate: 48_000 },
    },
  }
}

describe('editor session state', () => {
  beforeEach(() => useEditorStore.getState().reset())

  it('loads a path-free renderer session as a clean editing baseline', () => {
    useEditorStore.getState().loadSession(session(1))

    expect(useEditorStore.getState()).toMatchObject({
      session: session(1),
      isDirty: false,
      localEditRevision: 0,
    })
  })

  it('clears dirty only when the acknowledged Save matches the captured local edit revision', () => {
    useEditorStore.getState().loadSession(session(1))
    useEditorStore.getState().markEdited()
    const captured = useEditorStore.getState().localEditRevision

    const cleared = useEditorStore.getState().acknowledgeSave(session(2), captured)

    expect(cleared).toBe(true)
    expect(useEditorStore.getState()).toMatchObject({
      session: session(2),
      isDirty: false,
      localEditRevision: captured,
    })
  })

  it('retains newer local edits while accepting the acknowledged main revision', () => {
    useEditorStore.getState().loadSession(session(1))
    useEditorStore.getState().markEdited()
    const captured = useEditorStore.getState().localEditRevision
    useEditorStore.getState().markEdited()

    const cleared = useEditorStore.getState().acknowledgeSave(session(2), captured)

    expect(cleared).toBe(false)
    expect(useEditorStore.getState().session).toMatchObject({ revision: 2 })
    expect(useEditorStore.getState().isDirty).toBe(true)
    expect(useEditorStore.getState().localEditRevision).toBe(captured + 1)
  })

  it('can install an imported session without clearing dirty raced edits', () => {
    useEditorStore.getState().loadSession(session(1))
    useEditorStore.getState().markEdited()
    const localEditRevision = useEditorStore.getState().localEditRevision

    useEditorStore.getState().loadSession(session(2), true)

    expect(useEditorStore.getState()).toMatchObject({
      session: session(2),
      isDirty: true,
      localEditRevision,
    })
  })
})
