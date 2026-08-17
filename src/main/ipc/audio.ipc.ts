import { randomUUID } from 'crypto'
import { basename } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ImportJobRequest, SessionJobResult } from '../../shared/ipc.types'
import type { ImportCancellationResult, ImportMode } from '../../shared/import.types'
import type { RendererSession } from '../../shared/session.types'
import { ImportCoordinator } from '../audio/import/ImportCoordinator'
import { mergeProjectDraft } from '../project/sessionProjection'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import type { WorkspaceController } from '../project/WorkspaceController'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

type DiagnosticSink = (error: unknown) => void

export function registerAudioIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: DiagnosticSink = console.error,
): void {
  const selections = new Map<
    string,
    {
      senderId: number
      path: string
      workspaceToken: RendererSession['workspaceToken']
      revision: number
      expiresAt: number
    }
  >()
  const senderSelections = new Map<number, string>()
  const cancellationOutcomes = new Map<string, ImportCancellationResult>()
  const cancellationWaiters = new Map<string, number>()
  let coordinator = new ImportCoordinator(controller.workspace)
  let coordinatorRoot = controller.workspace.root

  ipcMain.handle('audio:select-import-file', (event, input: unknown) =>
    toIpcResult(async () => {
      const expected = requireSessionPrecondition(input)
      controller.assertCurrent(expected)
      const window =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
      const result = await dialog.showOpenDialog(window, {
        title: 'Import Audio',
        filters: [
          { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'aac', 'm4a', 'ogg', 'aiff'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      const token = randomUUID()
      const previous = senderSelections.get(event.sender.id)
      if (previous) selections.delete(previous)
      selections.set(token, {
        senderId: event.sender.id,
        path: result.filePaths[0],
        ...expected,
        expiresAt: Date.now() + 10 * 60 * 1000,
      })
      senderSelections.set(event.sender.id, token)
      event.sender.once('destroyed', () => {
        const active = senderSelections.get(event.sender.id)
        if (active) selections.delete(active)
        senderSelections.delete(event.sender.id)
      })
      return { token, displayName: basename(result.filePaths[0]) }
    }, diagnosticSink),
  )

  ipcMain.handle('audio:start-import', (event, input: unknown) =>
    toIpcResult(async (): Promise<SessionJobResult<RendererSession>> => {
      const request = importRequest(input)
      controller.assertCurrent(request)
      const selection = selections.get(request.selectionToken)
      selections.delete(request.selectionToken)
      if (senderSelections.get(event.sender.id) === request.selectionToken)
        senderSelections.delete(event.sender.id)
      if (
        !selection ||
        selection.senderId !== event.sender.id ||
        selection.workspaceToken !== request.workspaceToken ||
        selection.revision !== request.revision ||
        selection.expiresAt < Date.now()
      )
        throw new PublicIpcError('invalid-request')
      if (controller.workspace.root !== coordinatorRoot) {
        coordinator = new ImportCoordinator(controller.workspace)
        coordinatorRoot = controller.workspace.root
      }
      const jobCoordinator = coordinator
      let operation!: Promise<SessionJobResult<RendererSession>>
      const identity = {
        kind: 'import' as const,
        ...requestEnvelope(request),
        senderId: event.sender.id,
      }
      const cancellationKey = importIdentityKey(identity)
      cancellationOutcomes.delete(cancellationKey)
      const unregister = jobs.register(identity, () => {
        operation = (async () => {
          const project = mergeProjectDraft(controller.workspace.project, request.draft)
          const imported = await jobCoordinator.import<RendererSession>(
            request.jobId,
            selection.path,
            request.mode,
            project,
            (commit, signal) =>
              controller.runTransition(
                request,
                (transaction) =>
                  commit((preparedProject) => transaction.commitImport(preparedProject)),
                signal,
              ),
            (progress) => {
              if (event.sender.isDestroyed()) return
              try {
                controller.assertCurrent(request)
              } catch {
                return
              }
              event.sender.send('audio:import-progress', {
                workspaceToken: request.workspaceToken,
                revision: request.revision,
                jobId: request.jobId,
                displayName: progress.displayName,
                stage: progress.stage,
                percent: progress.percent,
              })
            },
          )
          return { ...requestEnvelope(request), value: imported.value }
        })()
        return {
          cancel: () => {
            cancellationOutcomes.set(cancellationKey, jobCoordinator.cancel(request.jobId))
          },
          settled: operation,
        }
      })
      event.sender.once('destroyed', () => {
        void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
      })
      try {
        return await operation
      } finally {
        unregister()
        if (!cancellationWaiters.has(cancellationKey)) cancellationOutcomes.delete(cancellationKey)
      }
    }, diagnosticSink),
  )

  ipcMain.handle('audio:cancel-import', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = importCancelRequest(input)
      const identity = {
        kind: 'import',
        ...request,
        senderId: event.sender.id,
      } as const
      const key = importIdentityKey(identity)
      cancellationWaiters.set(key, (cancellationWaiters.get(key) ?? 0) + 1)
      try {
        const found = await jobs.cancelAndSettleJob(identity)
        if (!found) return 'not-found'
        return cancellationOutcomes.get(key) ?? 'not-found'
      } finally {
        const remaining = (cancellationWaiters.get(key) ?? 1) - 1
        if (remaining > 0) cancellationWaiters.set(key, remaining)
        else {
          cancellationWaiters.delete(key)
          cancellationOutcomes.delete(key)
        }
      }
    }, diagnosticSink),
  )
}

function importRequest(input: unknown): ImportJobRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = input as Partial<ImportJobRequest>
  const jobId = requireJobId(candidate.jobId)
  if (
    typeof candidate.selectionToken !== 'string' ||
    (candidate.mode !== 'copy' && candidate.mode !== 'reference') ||
    !candidate.draft
  )
    throw new PublicIpcError('invalid-request')
  return {
    ...precondition,
    jobId,
    selectionToken: candidate.selectionToken,
    mode: candidate.mode as ImportMode,
    draft: candidate.draft,
  }
}

function importCancelRequest(input: unknown) {
  return {
    ...requireSessionPrecondition(input),
    jobId: requireJobId((input as { jobId?: unknown })?.jobId),
  }
}

function requestEnvelope(request: ImportJobRequest) {
  return {
    workspaceToken: request.workspaceToken,
    revision: request.revision,
    jobId: request.jobId,
  }
}

function importIdentityKey(identity: {
  jobId: string
  senderId: number
  workspaceToken: RendererSession['workspaceToken']
  revision: number
}): string {
  return JSON.stringify([
    identity.jobId,
    identity.senderId,
    identity.workspaceToken,
    identity.revision,
  ])
}
