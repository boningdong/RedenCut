import type {
  ImportCancellationResult,
  ImportMode,
  ImportProgress,
  ImportSelection,
} from './import.types'
import type { AudioSourceId, Transcript } from './project.types'
import type { TranscriptionCancellationResult, TranscriptionJobId } from './transcriber.types'
import type {
  ProjectDraft,
  ProjectMutationRequest,
  RendererSession,
  SessionPrecondition,
} from './session.types'

export interface IpcError {
  code: 'stale-session' | 'cancelled' | 'invalid-request' | 'operation-failed'
  message: string
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError }

export type ExportJobId = string & { readonly __brand: 'ExportJobId' }
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
  status: string
}

export interface RenderProgress {
  percent: number
  currentSeconds: number
  totalSeconds: number
}

export interface RenderProgressEvent extends SessionJobRequest<ExportJobId>, RenderProgress {}

export interface IElectronAPI {
  audio: {
    selectImportFile(expected: SessionPrecondition): Promise<ImportSelection | null>
    startImport(request: ImportJobRequest): Promise<SessionJobResult<RendererSession>>
    cancelImport(request: CancelSessionJobRequest): Promise<ImportCancellationResult>
  }
  project: {
    initialize(): Promise<RendererSession>
    openDialog(expected: SessionPrecondition): Promise<RendererSession | null>
    save(request: ProjectMutationRequest): Promise<RendererSession | null>
    saveAs(request: ProjectMutationRequest): Promise<RendererSession | null>
  }
  transcript: {
    checkAvailability(): Promise<string | null>
    generate(
      request: TranscriptionJobRequest,
    ): Promise<SessionJobResult<Transcript, TranscriptionJobId>>
    cancel(
      request: CancelSessionJobRequest<TranscriptionJobId>,
    ): Promise<TranscriptionCancellationResult>
  }
  render: {
    startExport(request: ExportJobRequest): Promise<SessionJobResult<boolean, ExportJobId>>
    cancelExport(request: CancelSessionJobRequest<ExportJobId>): Promise<ExportCancellationResult>
  }
  on: {
    importProgress(callback: (progress: ImportProgressEvent) => void): () => void
    transcriptProgress(callback: (progress: TranscriptProgressEvent) => void): () => void
    renderProgress(callback: (progress: RenderProgressEvent) => void): () => void
  }
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
