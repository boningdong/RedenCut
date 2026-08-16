import type { AudioSourceCacheDescriptor, WorkspaceDescriptor } from './import.types'
import type { AudioMetadata, AudioSourceId, ProjectFile, Track, Transcript } from './project.types'

export type WorkspaceToken = string & { readonly __brand: 'WorkspaceToken' }

export interface SessionPrecondition {
  workspaceToken: WorkspaceToken
  revision: number
}

export interface RendererAudioSource {
  id: AudioSourceId
  displayName: string
  metadata: AudioMetadata
  cache: AudioSourceCacheDescriptor
}

export interface ProjectDraft {
  tracks: Track[]
  transcript?: Transcript
  export: ProjectFile['export']
}

export interface RendererSession extends SessionPrecondition {
  workspace: WorkspaceDescriptor
  sources: RendererAudioSource[]
  draft: ProjectDraft
}

export interface ProjectMutationRequest extends SessionPrecondition {
  draft: ProjectDraft
}
