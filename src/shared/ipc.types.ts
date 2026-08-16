import type {
  ImportCancellationResult,
  ImportMode,
  ImportProgress,
  ImportSelection,
} from './import.types'
import type { AudioSourceId, Transcript } from './project.types'
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

interface SessionJobRequest extends SessionPrecondition {
  jobId: string
}

export type CancelSessionJobRequest = SessionJobRequest

export interface ImportJobRequest extends SessionJobRequest {
  selectionToken: string
  mode: ImportMode
  draft: ProjectDraft
}

export interface TranscriptionJobRequest extends SessionJobRequest {
  audioSourceId: AudioSourceId
  language?: string
}

export interface ExportJobRequest extends SessionJobRequest {
  draft: ProjectDraft
  format: ProjectDraft['export']['format']
}

export interface SessionJobResult<T> extends SessionJobRequest {
  value: T
}

export interface ImportProgressEvent extends SessionJobRequest {
  displayName: string
  stage: ImportProgress['stage']
  percent: number
}

export interface TranscriptProgressEvent extends SessionJobRequest {
  status: string
}

export interface RenderProgress {
  percent: number
  currentSeconds: number
  totalSeconds: number
}

export interface RenderProgressEvent extends SessionJobRequest, RenderProgress {}

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
    generate(request: TranscriptionJobRequest): Promise<SessionJobResult<Transcript>>
  }
  render: {
    export(request: ExportJobRequest): Promise<SessionJobResult<boolean>>
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
