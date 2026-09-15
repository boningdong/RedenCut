import { randomUUID } from 'crypto'
import { basename } from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { nativeProjectDialogs } from '../dialogs/nativeProjectDialogs'
import type { ProjectDialogs } from '../dialogs/ProjectDialogs'
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
  dialogs: ProjectDialogs = nativeProjectDialogs,
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
  const senderSelections = new Map<number, { token: string; sender: object }>()
  const selectionCleanupSenders = new WeakSet<object>()
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
      const selectedPath = await dialogs.importAudio(window)
      if (!selectedPath || event.sender.isDestroyed()) return null
      const token = randomUUID()
      const previous = senderSelections.get(event.sender.id)
      if (previous) selections.delete(previous.token)
      selections.set(token, {
        senderId: event.sender.id,
        path: selectedPath,
        ...expected,
        expiresAt: Date.now() + 10 * 60 * 1000,
      })
      senderSelections.set(event.sender.id, { token, sender: event.sender })
      if (!selectionCleanupSenders.has(event.sender)) {
        const ownedSender = event.sender
        const cleanupSelections = () => {
          const active = senderSelections.get(ownedSender.id)
          if (active?.sender === ownedSender) {
            selections.delete(active.token)
            senderSelections.delete(ownedSender.id)
          }
          selectionCleanupSenders.delete(ownedSender)
        }
        selectionCleanupSenders.add(ownedSender)
        ownedSender.once('destroyed', cleanupSelections)
      }
      return { token, displayName: basename(selectedPath) }
    }, diagnosticSink),
  )

  ipcMain.handle('audio:start-import', (event, input: unknown) =>
    toIpcResult(async (): Promise<SessionJobResult<RendererSession>> => {
      const request = importRequest(input)
      controller.assertCurrent(request)
      const selection = selections.get(request.selectionToken)
      selections.delete(request.selectionToken)
      const activeSelection = senderSelections.get(event.sender.id)
      if (
        activeSelection?.sender === event.sender &&
        activeSelection.token === request.selectionToken
      )
        senderSelections.delete(event.sender.id)
      if (
        !selection ||
        selection.senderId !== event.sender.id ||
        selection.workspaceToken !== request.workspaceToken ||
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
              controller.runBackgroundTransition(
                request,
                (transaction) =>
                  commit((preparedProject) => transaction.commitImport(preparedProject)),
                signal,
              ),
            (progress) => {
              if (event.sender.isDestroyed()) return
              try {
                controller.assertWorkspaceCurrent(request)
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
      const cancelSenderJobs = () => {
        void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
      }
      event.sender.once('destroyed', cancelSenderJobs)
      if (event.sender.isDestroyed()) cancelSenderJobs()
      try {
        return await operation
      } finally {
        event.sender.removeListener('destroyed', cancelSenderJobs)
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
