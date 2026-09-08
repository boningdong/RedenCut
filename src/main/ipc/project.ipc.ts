import { BrowserWindow, ipcMain } from 'electron'
import { nativeProjectDialogs } from '../dialogs/nativeProjectDialogs'
import type { ProjectDialogs } from '../dialogs/ProjectDialogs'
import type {
  OpenProjectRequest,
  ProjectMutationRequest,
  ProjectDraft,
} from '../../shared/session.types'
import type { PendingProjectOpenRegistry } from '../project/PendingProjectOpenRegistry'
import type { ProjectMutationCoordinator } from '../project/ProjectMutationCoordinator'
import type { ProjectTransitionCoordinator } from '../project/ProjectTransitionCoordinator'
import type { SessionSwitchBarrier } from '../project/SessionSwitchBarrier'
import type { WorkspaceController } from '../project/WorkspaceController'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

type DiagnosticSink = (error: unknown) => void

export function registerProjectIpc(
  controller: WorkspaceController,
  transitions: ProjectTransitionCoordinator,
  pendingOpens: PendingProjectOpenRegistry,
  switchBarrier: SessionSwitchBarrier,
  mutations: ProjectMutationCoordinator,
  diagnosticSink: DiagnosticSink = console.error,
  dialogs: ProjectDialogs = nativeProjectDialogs,
): void {
  ipcMain.handle('project:initialize', () =>
    toIpcResult(() => controller.describe(), diagnosticSink),
  )
  ipcMain.handle('project:open-dialog', (event, input: unknown) =>
    toIpcResult(
      () => transitions.openDialog(event.sender, openProjectRequest(input)),
      diagnosticSink,
    ),
  )
  ipcMain.handle('project:open-pending', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = openProjectRequest(input)
      const requestId = requireJobId((input as { requestId?: unknown })?.requestId)
      let path: string
      try {
        path = pendingOpens.consume(event.sender.id, requestId)
      } catch {
        throw new PublicIpcError('invalid-request')
      }
      return transitions.openPath(event.sender, request, path)
    }, diagnosticSink),
  )
  ipcMain.handle('project:acknowledge-switch', (event, input: unknown) =>
    toIpcResult(() => {
      const expected = requireSessionPrecondition(input)
      const transitionId = requireJobId((input as { transitionId?: unknown })?.transitionId)
      return switchBarrier.acknowledge(event.sender.id, { ...expected, transitionId })
    }, diagnosticSink),
  )
  ipcMain.handle('project:save', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = mutationRequest(input)
      if (controller.workspace.descriptor.kind === 'saved') return mutations.save(request)
      return chooseAndSaveAs(event.sender.id, mutations, request, dialogs)
    }, diagnosticSink),
  )
  ipcMain.handle('project:save-as', (event, input: unknown) =>
    toIpcResult(
      () => chooseAndSaveAs(event.sender.id, mutations, mutationRequest(input), dialogs),
      diagnosticSink,
    ),
  )
}

function openProjectRequest(input: unknown): OpenProjectRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = input as { isDirty?: unknown; draft?: unknown }
  if (candidate.isDirty === false) return { ...precondition, isDirty: false }
  if (candidate.isDirty === true && candidate.draft)
    return { ...precondition, isDirty: true, draft: candidate.draft as ProjectDraft }
  throw new PublicIpcError('invalid-request')
}

function mutationRequest(input: unknown): ProjectMutationRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object' || !('draft' in input))
    throw new PublicIpcError('invalid-request')
  return { ...precondition, draft: (input as ProjectMutationRequest).draft }
}

async function chooseAndSaveAs(
  senderId: number,
  mutations: ProjectMutationCoordinator,
  request: ProjectMutationRequest,
  dialogs: ProjectDialogs,
) {
  const window = BrowserWindow.getAllWindows().find(
    (candidate) => candidate.webContents.id === senderId,
  )
  const destination = await dialogs.saveProject(window ?? BrowserWindow.getFocusedWindow()!)
  if (!destination) return null
  return mutations.saveAs(destination, request)
}
