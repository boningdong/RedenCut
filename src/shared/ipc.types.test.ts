import { expectTypeOf, test } from 'vitest'
import type { ImportCancellationResult, ImportMode, ImportSelection } from './import.types'
import type { AudioSourceId, ProjectFile, Transcript } from './project.types'
import type { ProjectDraft, RendererSession, SessionPrecondition } from './session.types'
import type {
  CancelSessionJobRequest,
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
    (expected: SessionPrecondition) => Promise<RendererSession | null>
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
    (request: TranscriptionJobRequest) => Promise<SessionJobResult<Transcript>>
  >()
  expectTypeOf<IElectronAPI['render']['export']>().toEqualTypeOf<
    (request: ExportJobRequest) => Promise<SessionJobResult<boolean>>
  >()

  expectTypeOf<ImportJobRequest>().toMatchTypeOf<SessionPrecondition>()
  expectTypeOf<ImportJobRequest>().toMatchTypeOf<{
    jobId: string
    selectionToken: string
    mode: ImportMode
    draft: ProjectDraft
  }>()
  expectTypeOf<TranscriptionJobRequest>().toMatchTypeOf<{
    audioSourceId: AudioSourceId
  }>()
  expectTypeOf<ImportProgressEvent>().toMatchTypeOf<SessionPrecondition & { jobId: string }>()

  expectTypeOf<Parameters<IElectronAPI['project']['save']>[0]>().not.toMatchTypeOf<ProjectFile>()
  expectTypeOf<
    Parameters<IElectronAPI['audio']['startImport']>[0]
  >().not.toMatchTypeOf<ProjectFile>()
  expectTypeOf<Parameters<IElectronAPI['render']['export']>[0]>().not.toMatchTypeOf<ProjectFile>()
})
