import type { ProjectDraft, RendererSession } from '@shared/session.types'

interface ReconciledImport {
  session: RendererSession
  preserveDirty: boolean
}

export function reconcileImportedSession(
  imported: RendererSession,
  submittedDraft: ProjectDraft,
  latestDraft: ProjectDraft,
  submittedLocalEditRevision: number,
  latestLocalEditRevision: number,
): ReconciledImport {
  if (submittedLocalEditRevision === latestLocalEditRevision)
    return { session: imported, preserveDirty: false }

  const submittedTrackIds = new Set(submittedDraft.tracks.map((track) => track.id))
  const latestTrackIds = new Set(latestDraft.tracks.map((track) => track.id))
  const importedTracks = imported.draft.tracks.filter(
    (track) => !submittedTrackIds.has(track.id) && !latestTrackIds.has(track.id),
  )
  return {
    session: {
      ...imported,
      draft: {
        ...latestDraft,
        tracks: [...latestDraft.tracks, ...importedTracks],
      },
    },
    preserveDirty: true,
  }
}
