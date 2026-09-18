import type { SpeakerIdentityCatalog } from './SpeakerIdentityTypes'
import type { AudioSourceCacheDescriptor, WorkspaceDescriptor } from './import.types'
import type { AudioMetadata, AudioSourceId, ProjectFile, Track } from './project.types'
import type { RendererSpeechAnalysis } from './speech.types'

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
  export: ProjectFile['export']
}

export interface RendererSession extends SessionPrecondition {
  workspace: WorkspaceDescriptor
  sources: RendererAudioSource[]
  draft: ProjectDraft
  speakerIdentities?: SpeakerIdentityCatalog
  speechAnalyses: RendererSpeechAnalysis[]
}

export interface ProjectMutationRequest extends SessionPrecondition {
  draft: ProjectDraft
}

export type OpenProjectRequest = SessionPrecondition & { operationId: string } & (
    { isDirty: false } | { isDirty: true; draft: ProjectDraft }
  )

export type OpenProjectStayedReason =
  | 'cancelled'
  | 'save-failed'
  | 'candidate-invalid'
  | 'job-settlement-failed'
  | 'switch-unacknowledged'

export type OpenProjectResult =
  | { outcome: 'switched'; session: RendererSession }
  | { outcome: 'stayed'; session: RendererSession; reason: OpenProjectStayedReason }
