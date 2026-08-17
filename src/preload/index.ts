import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CancelSessionJobRequest,
  ExportJobRequest,
  IElectronAPI,
  ImportJobRequest,
  ImportProgressEvent,
  RenderProgressEvent,
  SessionJobResult,
  TranscriptProgressEvent,
  TranscriptionJobRequest,
} from '../shared/ipc.types'
import type { ImportSelection } from '../shared/import.types'
import type { ImportCancellationResult } from '../shared/import.types'
import type { Transcript } from '../shared/project.types'
import type {
  TranscriptionCancellationResult,
  TranscriptionJobId,
} from '../shared/transcriber.types'
import type {
  ProjectMutationRequest,
  RendererSession,
  SessionPrecondition,
} from '../shared/session.types'
import { invokeSafe } from './invokeSafe'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  audio: {
    selectImportFile: (expected: SessionPrecondition) =>
      invokeSafe<ImportSelection | null>(invoke, 'audio:select-import-file', expected),
    startImport: (request: ImportJobRequest) =>
      invokeSafe<SessionJobResult<RendererSession>>(invoke, 'audio:start-import', request),
    cancelImport: (request: CancelSessionJobRequest) =>
      invokeSafe<ImportCancellationResult>(invoke, 'audio:cancel-import', request),
  },
  project: {
    initialize: () => invokeSafe<RendererSession>(invoke, 'project:initialize'),
    openDialog: (expected: SessionPrecondition) =>
      invokeSafe<RendererSession | null>(invoke, 'project:open-dialog', expected),
    save: (request: ProjectMutationRequest) =>
      invokeSafe<RendererSession | null>(invoke, 'project:save', request),
    saveAs: (request: ProjectMutationRequest) =>
      invokeSafe<RendererSession | null>(invoke, 'project:save-as', request),
  },
  transcript: {
    checkAvailability: () => invokeSafe<string | null>(invoke, 'transcript:check-availability'),
    generate: (request: TranscriptionJobRequest) =>
      invokeSafe<SessionJobResult<Transcript, TranscriptionJobId>>(
        invoke,
        'transcript:generate',
        request,
      ),
    cancel: (request: CancelSessionJobRequest<TranscriptionJobId>) =>
      invokeSafe<TranscriptionCancellationResult>(invoke, 'transcript:cancel', request),
  },
  render: {
    export: (request: ExportJobRequest) =>
      invokeSafe<SessionJobResult<boolean>>(invoke, 'project:export', request),
  },
  on: {
    importProgress: (callback: (progress: ImportProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, progress: ImportProgressEvent) =>
        callback(progress)
      ipcRenderer.on('audio:import-progress', handler)
      return () => ipcRenderer.off('audio:import-progress', handler)
    },
    transcriptProgress: (callback: (progress: TranscriptProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, progress: TranscriptProgressEvent) =>
        callback(progress)
      ipcRenderer.on('transcript:progress', handler)
      return () => ipcRenderer.off('transcript:progress', handler)
    },
    renderProgress: (callback: (progress: RenderProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, progress: RenderProgressEvent) =>
        callback(progress)
      ipcRenderer.on('render:progress', handler)
      return () => ipcRenderer.off('render:progress', handler)
    },
  },
} satisfies IElectronAPI

contextBridge.exposeInMainWorld('electronAPI', api)
