import type { AudioSourceCacheDescriptor } from '../../shared/import.types'
import { ProjectFileSchema, type ProjectFile } from '../../shared/project.types'
import type { ProjectDraft, RendererSession, WorkspaceToken } from '../../shared/session.types'
import type { ProjectWorkspace } from './ProjectWorkspace'

export function toRendererSession(
  workspace: Pick<ProjectWorkspace, 'project' | 'descriptor'>,
  workspaceToken: WorkspaceToken,
  revision: number,
  descriptors: AudioSourceCacheDescriptor[],
): RendererSession {
  const descriptorsBySourceId = new Map(
    descriptors.map((descriptor) => [descriptor.audioSourceId, descriptor]),
  )

  return {
    workspaceToken,
    revision,
    workspace: workspace.descriptor,
    sources: workspace.project.audioSources.map((source) => {
      const cache = descriptorsBySourceId.get(source.id)
      if (!cache) throw new Error(`Missing cache descriptor for audio source ${source.id}`)
      return { id: source.id, displayName: source.displayName, metadata: source.metadata, cache }
    }),
    draft: {
      tracks: workspace.project.tracks,
      export: workspace.project.export,
    },
    speechAnalyses: [],
  }
}

export function mergeProjectDraft(authoritative: ProjectFile, draft: ProjectDraft): ProjectFile {
  return ProjectFileSchema.parse({
    ...authoritative,
    tracks: draft.tracks,
    export: draft.export,
  })
}
