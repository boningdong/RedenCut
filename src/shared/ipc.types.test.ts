import { expectTypeOf, test } from 'vitest'
import type { ImportCancellationResult, ImportMode, ImportSelection } from './import.types'
import type { AudioSourceId, ProjectFile, Transcript } from './project.types'
import type {
  OpenProjectRequest,
  OpenProjectResult,
  ProjectDraft,
  RendererSession,
  SessionPrecondition,
} from './session.types'
import type { TranscriptionCancellationResult, TranscriptionJobId } from './transcriber.types'
import type {
  CancelSessionJobRequest,
  ExportCancellationResult,
  ExportJobId,
  ExportJobRequest,
  IElectronAPI,
  ImportJobRequest,
  ImportProgressEvent,
  SessionJobResult,
  TranscriptionJobRequest,
} from './ipc.types'

test('preload methods use path-free session requests and results', () => {
  expectTypeOf<IElectronAPI['project']['initialize']>().toEqualTypeOf<
    () => Promise<RendererSession>
  >()
  expectTypeOf<IElectronAPI['project']['openDialog']>().toEqualTypeOf<
    (request: OpenProjectRequest) => Promise<OpenProjectResult>
  >()
  expectTypeOf<IElectronAPI['project']['openPending']>().toEqualTypeOf<
    (request: OpenProjectRequest & { requestId: string }) => Promise<OpenProjectResult>
  >()
  expectTypeOf<IElectronAPI['project']['save']>().toEqualTypeOf<
    (request: {
      workspaceToken: SessionPrecondition['workspaceToken']
      revision: number
      draft: ProjectDraft
    }) => Promise<RendererSession | null>
  >()
  expectTypeOf<IElectronAPI['project']['saveAs']>().toEqualTypeOf<
    (request: {
      workspaceToken: SessionPrecondition['workspaceToken']
      revision: number
      draft: ProjectDraft
    }) => Promise<RendererSession | null>
  >()
  expectTypeOf<IElectronAPI['audio']['selectImportFile']>().toEqualTypeOf<
    (expected: SessionPrecondition) => Promise<ImportSelection | null>
  >()
  expectTypeOf<IElectronAPI['audio']['startImport']>().toEqualTypeOf<
    (request: ImportJobRequest) => Promise<SessionJobResult<RendererSession>>
  >()
  expectTypeOf<IElectronAPI['audio']['cancelImport']>().toEqualTypeOf<
    (request: CancelSessionJobRequest) => Promise<ImportCancellationResult>
  >()
  expectTypeOf<IElectronAPI['transcript']['generate']>().toEqualTypeOf<
    (request: TranscriptionJobRequest) => Promise<SessionJobResult<Transcript, TranscriptionJobId>>
  >()
  expectTypeOf<IElectronAPI['transcript']['cancel']>().toEqualTypeOf<
    (
      request: CancelSessionJobRequest<TranscriptionJobId>,
    ) => Promise<TranscriptionCancellationResult>
  >()
  expectTypeOf<IElectronAPI['render']['startExport']>().toEqualTypeOf<
    (request: ExportJobRequest) => Promise<SessionJobResult<boolean, ExportJobId>>
  >()
  expectTypeOf<IElectronAPI['render']['cancelExport']>().toEqualTypeOf<
    (request: CancelSessionJobRequest<ExportJobId>) => Promise<ExportCancellationResult>
  >()
  expectTypeOf<Parameters<IElectronAPI['on']['projectWillSwitch']>[0]>().toEqualTypeOf<
    (event: {
      transitionId: string
      workspaceToken: SessionPrecondition['workspaceToken']
      revision: number
    }) => void | Promise<void>
  >()
  expectTypeOf<Parameters<IElectronAPI['on']['pendingProjectOpen']>[0]>().toEqualTypeOf<
    (event: { requestId: string; displayName: string }) => void | Promise<void>
  >()

  expectTypeOf<ImportJobRequest>().toMatchTypeOf<SessionPrecondition>()
  expectTypeOf<ImportJobRequest>().toMatchTypeOf<{
    jobId: string
    selectionToken: string
    mode: ImportMode
    draft: ProjectDraft
  }>()
  expectTypeOf<TranscriptionJobRequest>().toMatchTypeOf<{
    jobId: TranscriptionJobId
    audioSourceId: AudioSourceId
  }>()
  expectTypeOf<ExportJobRequest>().toMatchTypeOf<{
    jobId: ExportJobId
    draft: ProjectDraft
    format: ProjectDraft['export']['format']
  }>()
  expectTypeOf<ImportProgressEvent>().toMatchTypeOf<SessionPrecondition & { jobId: string }>()

  expectTypeOf<Parameters<IElectronAPI['project']['save']>[0]>().not.toMatchTypeOf<ProjectFile>()
  expectTypeOf<
    Parameters<IElectronAPI['audio']['startImport']>[0]
  >().not.toMatchTypeOf<ProjectFile>()
  expectTypeOf<
    Parameters<IElectronAPI['render']['startExport']>[0]
  >().not.toMatchTypeOf<ProjectFile>()
})
