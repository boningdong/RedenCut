import type { PublicMessage, TranscriptionProgress, SpeechProgress } from './publicMessages'
import type { AppPreferencesSnapshot } from './appPreferences.types'
import type { LocalePreference } from './i18n/locale.types'
import type { WorkspaceLayout, WorkspaceLayoutReadResult } from './workspaceLayout.types'
import type {
  ImportCancellationResult,
  ImportMode,
  ImportProgress,
  ImportSelection,
} from './import.types'
import type { AudioSourceId, Transcript } from './project.types'
import type { TranscriptionCancellationResult, TranscriptionJobId } from './transcriber.types'
import type {
  OpenProjectRequest,
  OpenProjectResult,
  ProjectDraft,
  ProjectMutationRequest,
  RendererSession,
  SessionPrecondition,
} from './session.types'
import type { RenameSpeakerRequest } from './speakerLabel.types'

export interface ProjectSwitchEvent extends SessionPrecondition {
  transitionId: string
}

export interface PendingProjectOpenEvent {
  requestId: string
  displayName: string
}

export interface IpcError {
  code: 'stale-session' | 'cancelled' | 'invalid-request' | 'operation-failed'
  message: string
  reason: PublicMessage['reason']
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }

export type ExportJobId = string & { readonly __brand: 'ExportJobId' }
export type SpeechAnalysisJobId = string & { readonly __brand: 'SpeechAnalysisJobId' }
export type ExportCancellationResult = 'cancelled' | 'commit-won' | 'not-found'

interface SessionJobRequest<JobId extends string = string> extends SessionPrecondition {
  jobId: JobId
}

export type CancelSessionJobRequest<JobId extends string = string> = SessionJobRequest<JobId>

export interface ImportJobRequest extends SessionJobRequest {
  selectionToken: string
  mode: ImportMode
  draft: ProjectDraft
}

export interface TranscriptionJobRequest extends SessionJobRequest<TranscriptionJobId> {
  audioSourceId: AudioSourceId
  language?: string
}

export interface SpeechAnalysisJobRequest extends SessionJobRequest<SpeechAnalysisJobId> {
  audioSourceId: AudioSourceId
  language: string
  draft: ProjectDraft
  confirmSpeakerLabelReset?: boolean
}

export interface ExportJobRequest extends SessionJobRequest<ExportJobId> {
  draft: ProjectDraft
  format: ProjectDraft['export']['format']
}

export interface SessionJobResult<
  T,
  JobId extends string = string,
> extends SessionJobRequest<JobId> {
  value: T
}

export interface ImportProgressEvent extends SessionJobRequest {
  displayName: string
  stage: ImportProgress['stage']
  percent: number
}

export interface TranscriptProgressEvent extends SessionJobRequest<TranscriptionJobId> {
  status: TranscriptionProgress
}

export interface SpeechAnalysisProgressEvent extends SessionJobRequest<SpeechAnalysisJobId> {
  stage: SpeechProgress['stage']
  percent?: number
}

export interface RenderProgress {
  percent: number
  currentSeconds: number
  totalSeconds: number
}

export interface RenderProgressEvent extends SessionJobRequest<ExportJobId>, RenderProgress {}

export interface IElectronAPI {
  appPreferences: {
    get(): Promise<AppPreferencesSnapshot>
    setLocale(preference: LocalePreference): Promise<AppPreferencesSnapshot>
    onChanged(listener: (value: AppPreferencesSnapshot) => void): () => void
  }
  workspaceLayout: {
    get(): Promise<WorkspaceLayoutReadResult>
    set(layout: WorkspaceLayout): Promise<WorkspaceLayout>
  }
  audio: {
    selectImportFile(expected: SessionPrecondition): Promise<ImportSelection | null>
    startImport(request: ImportJobRequest): Promise<SessionJobResult<RendererSession>>
    cancelImport(request: CancelSessionJobRequest): Promise<ImportCancellationResult>
  }
  project: {
    initialize(): Promise<RendererSession>
    openDialog(request: OpenProjectRequest): Promise<OpenProjectResult>
    openPending(request: OpenProjectRequest & { requestId: string }): Promise<OpenProjectResult>
    acknowledgeSwitch(event: ProjectSwitchEvent): Promise<boolean>
    save(request: ProjectMutationRequest): Promise<RendererSession | null>
    saveAs(request: ProjectMutationRequest): Promise<RendererSession | null>
  }
  transcript: {
    checkAvailability(): Promise<PublicMessage | null>
    generate(
      request: TranscriptionJobRequest,
    ): Promise<SessionJobResult<Transcript, TranscriptionJobId>>
    cancel(
      request: CancelSessionJobRequest<TranscriptionJobId>,
    ): Promise<TranscriptionCancellationResult>
  }
  speechAnalysis: {
    checkAvailability(): Promise<PublicMessage | null>
    start(
      request: SpeechAnalysisJobRequest,
    ): Promise<SessionJobResult<RendererSession, SpeechAnalysisJobId>>
    cancel(
      request: CancelSessionJobRequest<SpeechAnalysisJobId>,
    ): Promise<TranscriptionCancellationResult>
  }
  speakerLabel: {
    rename(request: RenameSpeakerRequest): Promise<RendererSession>
  }
  render: {
    startExport(request: ExportJobRequest): Promise<SessionJobResult<boolean, ExportJobId>>
    cancelExport(request: CancelSessionJobRequest<ExportJobId>): Promise<ExportCancellationResult>
  }
  on: {
    importProgress(callback: (progress: ImportProgressEvent) => void): () => void
    transcriptProgress(callback: (progress: TranscriptProgressEvent) => void): () => void
    speechAnalysisProgress(callback: (progress: SpeechAnalysisProgressEvent) => void): () => void
    renderProgress(callback: (progress: RenderProgressEvent) => void): () => void
    projectWillSwitch(callback: (event: ProjectSwitchEvent) => void | Promise<void>): () => void
    pendingProjectOpen(
      callback: (event: PendingProjectOpenEvent) => void | Promise<void>,
    ): () => void
  }
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
