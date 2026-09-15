import type { SpeechBatchSummary } from '../shared/speechBatch.types'
import type { ResourceSnapshot, ResourcePreparation } from '../shared/resources.types'
import type { ModelAccessSnapshot, LocalModelLoginSnapshot } from '../shared/modelAccess.types'
import type { PublicMessage } from '../shared/publicMessages'
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
import type { Transcript } from '../shared/project.types'
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

const api = {
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
  modelAccessLocal: () => invokeSafe<LocalModelLoginSnapshot>(invoke, 'model-access:local'),
  modelAccessVerifyLocal: () =>
    invokeSafe<ModelAccessSnapshot>(invoke, 'model-access:verify-local'),
  modelAccessGet: () => invokeSafe<ModelAccessSnapshot>(invoke, 'model-access:get'),
  modelAccessVerify: (token?: string) =>
    invokeSafe<ModelAccessSnapshot>(invoke, 'model-access:verify', token),
  modelAccessClear: () => invokeSafe<ModelAccessSnapshot>(invoke, 'model-access:clear'),
  modelAccessOpenConditions: () => invokeSafe<void>(invoke, 'model-access:open-conditions'),
  onModelAccessChanged: (listener: (value: ModelAccessSnapshot) => void) => {
    const handler = (_event: IpcRendererEvent, value: ModelAccessSnapshot) => listener(value)
    ipcRenderer.on('model-access:changed', handler)
    return () => {
      ipcRenderer.off('model-access:changed', handler)
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
  audio: {
    selectImportFile: (expected: SessionPrecondition) =>
      invokeSafe<ImportSelection | null>(invoke, 'audio:select-import-file', expected),
    startImport: (request: ImportJobRequest) =>
      invokeSafe<SessionJobResult<RendererSession>>(invoke, 'audio:start-import', request),
    cancelImport: (request: CancelSessionJobRequest) =>
      invokeSafe<ImportCancellationResult>(invoke, 'audio:cancel-import', request),
  },
  project: {
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
    checkAvailability: () =>
      invokeSafe<PublicMessage | null>(invoke, 'speech-analysis:check-availability'),
    start: (request: SpeechAnalysisJobRequest) =>
      invokeSafe<
        SessionJobResult<RendererSession, SpeechAnalysisJobId> & { batch?: SpeechBatchSummary }
      >(invoke, 'speech-analysis:start', request),
    cancel: (request: CancelSessionJobRequest<SpeechAnalysisJobId>) =>
      invokeSafe<TranscriptionCancellationResult>(invoke, 'speech-analysis:cancel', request),
  },
  workspaceLayout: {
    get: () => invokeSafe<WorkspaceLayoutReadResult>(invoke, 'workspace-layout:get'),
    set: (layout: WorkspaceLayout) =>
      invokeSafe<WorkspaceLayout>(invoke, 'workspace-layout:set', layout),
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
