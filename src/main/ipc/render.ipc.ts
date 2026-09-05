import { BrowserWindow, dialog, ipcMain } from 'electron'
import type {
  CancelSessionJobRequest,
  ExportCancellationResult,
  ExportJobId,
  ExportJobRequest,
  SessionJobResult,
} from '../../shared/ipc.types'
import { ProjectFileSchema } from '../../shared/project.types'
import { ExportCoordinator } from '../audio/export/ExportCoordinator'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import { mergeProjectDraft } from '../project/sessionProjection'
import type { WorkspaceController } from '../project/WorkspaceController'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'
import { assertNativeDialogAllowed } from '../harnessDialogPolicy'

type DiagnosticSink = (error: unknown) => void

export function registerRenderIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: DiagnosticSink = console.error,
  coordinator = new ExportCoordinator(),
): void {
  const cancellationOutcomes = new Map<string, ExportCancellationResult>()
  const cancellationWaiters = new Map<string, number>()

  ipcMain.handle('render:start-export', (event, input: unknown) =>
    toIpcResult(async (): Promise<SessionJobResult<boolean, ExportJobId>> => {
      const request = exportRequest(input)
      controller.assertCurrent(request)
      const identity = {
        kind: 'export' as const,
        ...requestEnvelope(request),
        senderId: event.sender.id,
      }
      const cancellationKey = exportIdentityKey(identity)
      cancellationOutcomes.delete(cancellationKey)
      let operation!: Promise<SessionJobResult<boolean, ExportJobId>>
      const unregister = jobs.register(identity, () => {
        const resolveOriginal = controller.captureOriginalResolver(request)
        const authoritative = mergeProjectDraft(controller.workspace.project, request.draft)
        const project = ProjectFileSchema.parse({
          ...authoritative,
          export: { ...authoritative.export, format: request.format },
        })
        const window =
          BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
        const execution = coordinator.start({
          identity,
          project,
          resolveOriginal,
          selectDestination: async () => {
            assertNativeDialogAllowed()
            const destination = await dialog.showSaveDialog(window, {
              title: 'Export Audio',
              defaultPath: `export.${project.export.format}`,
              filters: [
                {
                  name: project.export.format.toUpperCase(),
                  extensions: [project.export.format],
                },
              ],
            })
            return destination.canceled || !destination.filePath ? null : destination.filePath
          },
          revalidate: () => controller.assertCurrent(request),
          onProgress: (progress) => {
            if (event.sender.isDestroyed()) return
            try {
              controller.assertCurrent(request)
            } catch {
              return
            }
            event.sender.send('render:progress', progress)
          },
        })
        operation = execution.settled.then((result) => {
          controller.assertCurrent(request)
          return result
        })
        return {
          cancel: async () => {
            cancellationOutcomes.set(cancellationKey, await execution.requestCancel())
          },
          settled: operation,
        }
      })
      const cancelSenderJobs = () => {
        void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
      }
      event.sender.once('destroyed', cancelSenderJobs)
      try {
        return await operation
      } finally {
        event.sender.removeListener('destroyed', cancelSenderJobs)
        unregister()
        if (!cancellationWaiters.has(cancellationKey)) cancellationOutcomes.delete(cancellationKey)
      }
    }, diagnosticSink),
  )

  ipcMain.handle('render:cancel-export', (event, input: unknown) =>
    toIpcResult(async (): Promise<ExportCancellationResult> => {
      const request = exportCancelRequest(input)
      const identity = {
        kind: 'export' as const,
        ...request,
        senderId: event.sender.id,
      }
      const key = exportIdentityKey(identity)
      cancellationWaiters.set(key, (cancellationWaiters.get(key) ?? 0) + 1)
      try {
        const found = await jobs.cancelAndSettleJob(identity)
        return found ? (cancellationOutcomes.get(key) ?? 'not-found') : 'not-found'
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

function exportRequest(input: unknown): ExportJobRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = input as Partial<ExportJobRequest>
  if (!candidate.draft || !['mp3', 'wav', 'flac', 'aac'].includes(candidate.format ?? ''))
    throw new PublicIpcError('invalid-request')
  return {
    ...precondition,
    jobId: requireJobId(candidate.jobId) as ExportJobId,
    draft: candidate.draft,
    format: candidate.format!,
  }
}

function exportCancelRequest(input: unknown): CancelSessionJobRequest<ExportJobId> {
  return {
    ...requireSessionPrecondition(input),
    jobId: requireJobId((input as { jobId?: unknown })?.jobId) as ExportJobId,
  }
}

function requestEnvelope(request: ExportJobRequest) {
  return {
    workspaceToken: request.workspaceToken,
    revision: request.revision,
    jobId: request.jobId,
  }
}

function exportIdentityKey(identity: {
  jobId: ExportJobId
  senderId: number
  workspaceToken: ExportJobRequest['workspaceToken']
  revision: number
}): string {
  return JSON.stringify([
    identity.jobId,
    identity.senderId,
    identity.workspaceToken,
    identity.revision,
  ])
}
