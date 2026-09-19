import { beforeEach, describe, expect, it } from 'vitest'
import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import type {
  ProjectDraft,
  RendererAudioSource,
  RendererSession,
  WorkspaceToken,
} from '@shared/session.types'
import { reconcileImportedSession } from './importSessionReconciler'
import { useEditorStore } from './stores/editor.store'
import { useTimelineStore } from './stores/TimelineStore'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001' as AudioSourceId

function track(id: string, name: string): Track {
  return {
    id,
    name,
    clips: [],
    volume: 1,
    muted: false,
    solo: false,
    color: '#6366f1',
    effects: [],
  }
}

function draft(tracks: Track[]): ProjectDraft {
  return {
    tracks,
    export: { format: 'wav', targetLUFS: -14, truePeakDbTP: -2, sampleRate: 48_000 },
  }
}

function importedSession(importedTrack: Track): RendererSession {
  const source: RendererAudioSource = {
    id: SOURCE_ID,
    displayName: 'episode.wav',
    metadata: {
      durationSeconds: 1,
      sampleRate: 48_000,
      channels: 1,
      codec: 'pcm_s16le',
      bitrateKbps: 768,
    },
    cache: {
      audioSourceId: SOURCE_ID,
      sampleRate: 48_000,
      channels: 1,
      frameCount: 48_000,
      waveformLevels: [],
    },
  }
  return {
    workspaceToken: 'token-a' as WorkspaceToken,
    revision: 2,
    workspace: { kind: 'temporary', displayName: 'Untitled', portable: true },
    sources: [source],
    speechAnalyses: [],
    draft: draft([track('submitted', 'Submitted snapshot'), importedTrack]),
  }
}

describe('import session reconciliation', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useTimelineStore.getState().reset()
  })

  it('accepts the authoritative returned session when no local edits raced', () => {
    const submitted = draft([track('submitted', 'Submitted')])
    const imported = importedSession(track('imported', 'Imported'))

    expect(reconcileImportedSession(imported, submitted, submitted, 4, 4)).toEqual({
      session: imported,
      preserveDirty: false,
    })
  })

  it('merges only new imported tracks into the latest draft and preserves raced edits', () => {
    const submitted = draft([track('submitted', 'Before edit')])
    const latest = draft([track('submitted', 'Edited while importing')])
    latest.export.format = 'flac'
    const importedTrack = track('imported', 'Imported')
    const imported = importedSession(importedTrack)

    const result = reconcileImportedSession(imported, submitted, latest, 4, 5)

    expect(result.session.sources).toEqual(imported.sources)
    expect(result.session.draft.tracks).toEqual([...latest.tracks, importedTrack])
    expect(result.session.draft.export).toEqual(latest.export)
    expect(result.preserveDirty).toBe(true)
  })

  it('observes a timeline mutation synchronously before provider preparation completes', () => {
    const submitted = draft([track('submitted', 'Before edit')])
    const initial = {
      ...importedSession(track('unused', 'Unused')),
      revision: 1,
      sources: [],
      draft: submitted,
    }
    useEditorStore.getState().loadSession(initial)
    useTimelineStore.getState().loadFromProject([], submitted.tracks)
    const submittedLocalEditRevision = useEditorStore.getState().localEditRevision

    // This mutation happens synchronously, before React can run the tracks effect.
    useTimelineStore.getState().updateTrack('submitted', { name: 'Edited before effect' })

    const editorAfterMutation = useEditorStore.getState()
    expect(editorAfterMutation.localEditRevision).toBe(submittedLocalEditRevision + 1)
    expect(editorAfterMutation.isDirty).toBe(true)

    // Import completion/provider preparation samples the stores in the same turn.
    const latest = draft(useTimelineStore.getState().tracks)
    const importedTrack = track('imported', 'Imported')
    const reconciled = reconcileImportedSession(
      importedSession(importedTrack),
      submitted,
      latest,
      submittedLocalEditRevision,
      editorAfterMutation.localEditRevision,
    )

    expect(reconciled.session.draft.tracks).toEqual([
      track('submitted', 'Edited before effect'),
      importedTrack,
    ])
    expect(reconciled.preserveDirty).toBe(true)
  })
})
