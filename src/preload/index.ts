import type { ProjectCommand, ProjectCloseRequest } from '../shared/ProjectCommands'
import type { PreparedAudioAPI } from '../shared/PreparedAudioTypes'
import type { ProjectOpenProgressEvent } from '../shared/AudioPreparationTypes'
import type { MediaRecoverySnapshot } from '../shared/MediaRecoveryTypes'
import type { SaveSpeakerIdentitiesRequest } from '../shared/SpeakerIdentityTypes'
import type { SpeechBatchSummary } from '../shared/speechBatch.types'
import type { ResourceSnapshot, ResourcePreparation } from '../shared/resources.types'
import type { PublicMessage } from '../shared/publicMessages'
import type { DiagnosticReportPreview, DiagnosticSaveResult } from '../shared/diagnostics.types'
import type {
  AppPreferencesSnapshot,
  ThemeId,
  FeaturePreferences,
  OnboardingDisposition,
} from '../shared/appPreferences.types'
import type { LocalePreference } from '../shared/i18n/locale.types'
import type { WorkspaceLayout, WorkspaceLayoutReadResult } from '../shared/workspaceLayout.types'
import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CancelSessionJobRequest,
  ExportCancellationResult,
  ExportJobId,
  ExportJobRequest,
  IElectronAPI,
  ImportJobRequest,
  ImportProgressEvent,
  PendingProjectOpenEvent,
  ProjectSwitchEvent,
  RenderProgressEvent,
  SessionJobResult,
  TranscriptProgressEvent,
  TranscriptionJobRequest,
  SpeechAnalysisJobRequest,
  SpeechAnalysisJobId,
  SpeechAnalysisProgressEvent,
} from '../shared/ipc.types'
import type { ImportSelection } from '../shared/import.types'
import type { ImportCancellationResult } from '../shared/import.types'
import type { Transcript } from '../shared/ProjectTypes'
import type { RenameSpeakerRequest } from '../shared/speakerLabel.types'
import type {
  TranscriptionCancellationResult,
  TranscriptionJobId,
} from '../shared/transcriber.types'
import type {
  OpenProjectRequest,
  OpenProjectResult,
  ProjectMutationRequest,
  RendererSession,
  SessionPrecondition,
} from '../shared/session.types'
import { invokeSafe } from './invokeSafe'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const pendingProjectOpenEvents: PendingProjectOpenEvent[] = []
const pendingProjectOpenCallbacks = new Set<
  (event: PendingProjectOpenEvent) => void | Promise<void>
>()
ipcRenderer.on('project:pending-open', (_event, value: PendingProjectOpenEvent) => {
  if (pendingProjectOpenCallbacks.size === 0) {
    pendingProjectOpenEvents.push(value)
    return
  }
  pendingProjectOpenCallbacks.forEach((callback) => void callback(value))
})

// Native menus may target a recreated window before React has mounted its listeners.
function bufferedProjectEvents<T>(channel: 'project:command' | 'project:close-request') {
  const pending: T[] = []
  const listeners = new Set<(value: T) => void>()
  ipcRenderer.on(channel, (_event, value: T) => {
    if (!listeners.size) {
      pending.push(value)
      return
    }
    listeners.forEach((listener) => listener(value))
  })
  return (listener: (value: T) => void) => {
    listeners.add(listener)
    pending.splice(0).forEach((value) => listener(value))
    return () => {
      listeners.delete(listener)
    }
  }
}
const projectCommands = bufferedProjectEvents<ProjectCommand>('project:command')
const projectCloseRequests = bufferedProjectEvents<ProjectCloseRequest>('project:close-request')

const api = {
  resourcesSelectWhisper: (modelId: string) =>
    invokeSafe<ResourceSnapshot>(invoke, 'resources:select-whisper', modelId),
  resourcesGet: () => invokeSafe<ResourceSnapshot>(invoke, 'resources:get'),
  resourcesPrepare: (target: ResourcePreparation) =>
    invokeSafe<ResourceSnapshot>(invoke, 'resources:prepare', target),
  resourcesOpenGuide: (guide) => invokeSafe<void>(invoke, 'resources:open-guide', guide),
  resourcesCancel: () => invokeSafe<ResourceSnapshot>(invoke, 'resources:cancel'),
  onResourcesChanged: (listener: (value: ResourceSnapshot) => void) => {
    const handler = (_event: IpcRendererEvent, value: ResourceSnapshot) => listener(value)
    ipcRenderer.on('resources:changed', handler)
    return () => {
      ipcRenderer.off('resources:changed', handler)
    }
  },
  appPreferences: {
    setTheme: (value: ThemeId) =>
      invokeSafe<AppPreferencesSnapshot>(invoke, 'app-preferences:set-theme', value),
    migrateTheme: (value: ThemeId) =>
      invokeSafe<AppPreferencesSnapshot>(invoke, 'app-preferences:migrate-theme', value),
    setFeaturePreferences: (value: FeaturePreferences) =>
      invokeSafe<AppPreferencesSnapshot>(invoke, 'app-preferences:set-features', value),
    setOnboardingDisposition: (value: OnboardingDisposition) =>
      invokeSafe<AppPreferencesSnapshot>(invoke, 'app-preferences:set-onboarding', value),
    get: () => invokeSafe<AppPreferencesSnapshot>(invoke, 'app-preferences:get'),
    setLocale: (preference: LocalePreference) =>
      invokeSafe<AppPreferencesSnapshot>(invoke, 'app-preferences:set-locale', preference),
    onChanged: (listener: (value: AppPreferencesSnapshot) => void) => {
      const handler = (_event: IpcRendererEvent, value: AppPreferencesSnapshot) => listener(value)
      ipcRenderer.on('app-preferences:changed', handler)
      return () => ipcRenderer.off('app-preferences:changed', handler)
    },
  },
  preparedAudio: {
    progress: (request) =>
      invokeSafe<Awaited<ReturnType<PreparedAudioAPI['progress']>>>(
        invoke,
        'effects:progress',
        request,
      ),
    waveform: (request) =>
      invokeSafe<Awaited<ReturnType<PreparedAudioAPI['waveform']>>>(
        invoke,
        'effects:waveform',
        request,
      ),
    prepare: (request) =>
      invokeSafe<Awaited<ReturnType<PreparedAudioAPI['prepare']>>>(
        invoke,
        'effects:prepare',
        request,
      ),
    read: (request) =>
      invokeSafe<Awaited<ReturnType<PreparedAudioAPI['read']>>>(invoke, 'effects:read', request),
    release: (request) => invokeSafe<void>(invoke, 'effects:release', request),
  },
  audio: {
    selectImportFile: (expected: SessionPrecondition) =>
      invokeSafe<ImportSelection | null>(invoke, 'audio:select-import-file', expected),
    startImport: (request: ImportJobRequest) =>
      invokeSafe<SessionJobResult<RendererSession>>(invoke, 'audio:start-import', request),
    cancelImport: (request: CancelSessionJobRequest) =>
      invokeSafe<ImportCancellationResult>(invoke, 'audio:cancel-import', request),
  },
  mediaRecovery: {
    locate: (request) => invokeSafe<void>(invoke, 'media-recovery:locate', request),
    continue: (request) => invokeSafe<void>(invoke, 'media-recovery:continue', request),
    cancel: (request) => invokeSafe<void>(invoke, 'media-recovery:cancel', request),
  },
  project: {
    respondToClose: (requestId: string, allowed: boolean) =>
      invoke('project:close-response', requestId, allowed) as Promise<boolean>,
    openStarter: (request: OpenProjectRequest, kind: 'sample' | 'empty') =>
      invokeSafe<OpenProjectResult>(invoke, 'project:open-starter', request, kind),
    initialize: () => invokeSafe<RendererSession>(invoke, 'project:initialize'),
    openDialog: (request: OpenProjectRequest) =>
      invokeSafe<OpenProjectResult>(invoke, 'project:open-dialog', request),
    openPending: (request: OpenProjectRequest & { requestId: string }) =>
      invokeSafe<OpenProjectResult>(invoke, 'project:open-pending', request),
    acknowledgeSwitch: (event: ProjectSwitchEvent) =>
      invokeSafe<boolean>(invoke, 'project:acknowledge-switch', event),
    save: (request: ProjectMutationRequest) =>
      invokeSafe<RendererSession | null>(invoke, 'project:save', request),
    saveAs: (request: ProjectMutationRequest) =>
      invokeSafe<RendererSession | null>(invoke, 'project:save-as', request),
  },
  transcript: {
    checkAvailability: () =>
      invokeSafe<PublicMessage | null>(invoke, 'transcript:check-availability'),
    generate: (request: TranscriptionJobRequest) =>
      invokeSafe<SessionJobResult<Transcript, TranscriptionJobId>>(
        invoke,
        'transcript:generate',
        request,
      ),
    cancel: (request: CancelSessionJobRequest<TranscriptionJobId>) =>
      invokeSafe<TranscriptionCancellationResult>(invoke, 'transcript:cancel', request),
  },
  speechAnalysis: {
    checkAvailability: (tasks) =>
      invokeSafe<PublicMessage | null>(invoke, 'speech-analysis:check-availability', tasks),
    start: (request: SpeechAnalysisJobRequest) =>
      invokeSafe<
        SessionJobResult<RendererSession, SpeechAnalysisJobId> & { batch?: SpeechBatchSummary }
      >(invoke, 'speech-analysis:start', request),
    cancel: (request: CancelSessionJobRequest<SpeechAnalysisJobId>) =>
      invokeSafe<TranscriptionCancellationResult>(invoke, 'speech-analysis:cancel', request),
  },
  diagnostics: {
    recentFailure: () => invokeSafe<string | null>(invoke, 'diagnostics:recent-failure'),
    previewReport: (diagnosticIds: string[]) =>
      invokeSafe<DiagnosticReportPreview>(invoke, 'diagnostics:preview', { diagnosticIds }),
    saveReport: (previewId: string) =>
      invokeSafe<DiagnosticSaveResult>(invoke, 'diagnostics:save', previewId),
    showSavedReport: (previewId: string) =>
      invokeSafe<void>(invoke, 'diagnostics:show-saved', previewId),
  },
  workspaceLayout: {
    get: () => invokeSafe<WorkspaceLayoutReadResult>(invoke, 'workspace-layout:get'),
    set: (layout: WorkspaceLayout) =>
      invokeSafe<WorkspaceLayout>(invoke, 'workspace-layout:set', layout),
  },
  speakerIdentity: {
    save: (request: SaveSpeakerIdentitiesRequest) =>
      invokeSafe<RendererSession>(invoke, 'speaker-identity:save', request),
  },
  speakerLabel: {
    rename: (request: RenameSpeakerRequest) =>
      invokeSafe<RendererSession>(invoke, 'speaker-label:rename', request),
  },
  render: {
    startExport: (request: ExportJobRequest) =>
      invokeSafe<SessionJobResult<boolean, ExportJobId>>(invoke, 'render:start-export', request),
    cancelExport: (request: CancelSessionJobRequest<ExportJobId>) =>
      invokeSafe<ExportCancellationResult>(invoke, 'render:cancel-export', request),
  },
  on: {
    openRecentDiagnostic: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('diagnostics:open-recent', handler)
      return () => ipcRenderer.off('diagnostics:open-recent', handler)
    },
    projectCommand: projectCommands,
    projectCloseRequest: projectCloseRequests,
    projectOpenProgress: (callback: (progress: ProjectOpenProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, progress: ProjectOpenProgressEvent) =>
        callback(progress)
      ipcRenderer.on('project:open-progress', handler)
      return () => ipcRenderer.off('project:open-progress', handler)
    },
    mediaRecoveryChanged: (callback: (snapshot: MediaRecoverySnapshot) => void) => {
      const handler = (_event: IpcRendererEvent, snapshot: MediaRecoverySnapshot) =>
        callback(snapshot)
      ipcRenderer.on('media-recovery:changed', handler)
      return () => ipcRenderer.off('media-recovery:changed', handler)
    },
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
    speechAnalysisProgress: (callback: (progress: SpeechAnalysisProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, progress: SpeechAnalysisProgressEvent) =>
        callback(progress)
      ipcRenderer.on('speech-analysis:progress', handler)
      return () => ipcRenderer.off('speech-analysis:progress', handler)
    },
    renderProgress: (callback: (progress: RenderProgressEvent) => void) => {
      const handler = (_event: IpcRendererEvent, progress: RenderProgressEvent) =>
        callback(progress)
      ipcRenderer.on('render:progress', handler)
      return () => ipcRenderer.off('render:progress', handler)
    },
    projectWillSwitch: (callback: (event: ProjectSwitchEvent) => void | Promise<void>) => {
      const handler = (_event: IpcRendererEvent, value: ProjectSwitchEvent) => void callback(value)
      ipcRenderer.on('project:will-switch', handler)
      return () => ipcRenderer.off('project:will-switch', handler)
    },
    pendingProjectOpen: (callback: (event: PendingProjectOpenEvent) => void | Promise<void>) => {
      pendingProjectOpenCallbacks.add(callback)
      pendingProjectOpenEvents.splice(0).forEach((value) => void callback(value))
      return () => pendingProjectOpenCallbacks.delete(callback)
    },
  },
} satisfies IElectronAPI

contextBridge.exposeInMainWorld('electronAPI', api)
