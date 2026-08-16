import { BrowserWindow, dialog, ipcMain } from 'electron'
import { APP_FILE_EXT, APP_NAME } from '../../shared/constants'
import type { ProjectMutationRequest } from '../../shared/session.types'
import type { WorkspaceController } from '../project/WorkspaceController'
import { PublicIpcError, requireSessionPrecondition, toIpcResult } from './ipcResult'

type DiagnosticSink = (error: unknown) => void

export function registerProjectIpc(
  controller: WorkspaceController,
  diagnosticSink: DiagnosticSink = console.error,
): void {
  ipcMain.handle('project:initialize', () =>
    toIpcResult(() => controller.describe(), diagnosticSink),
  )
  ipcMain.handle('project:open-dialog', (event, input: unknown) =>
    toIpcResult(async () => {
      const expected = requireSessionPrecondition(input)
      const window =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
      const result = await dialog.showOpenDialog(window, {
        title: `Open ${APP_NAME} Project`,
        properties: ['openDirectory'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      const candidate = await controller.prepareOpen(result.filePaths[0])
      return controller.commitPreparedOpen(candidate, expected)
    }, diagnosticSink),
  )
  ipcMain.handle('project:save', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = mutationRequest(input)
      if (controller.workspace.descriptor.kind === 'saved') return controller.save(request)
      return chooseAndSaveAs(event.sender.id, controller, request)
    }, diagnosticSink),
  )
  ipcMain.handle('project:save-as', (event, input: unknown) =>
    toIpcResult(
      () => chooseAndSaveAs(event.sender.id, controller, mutationRequest(input)),
      diagnosticSink,
    ),
  )
}

function mutationRequest(input: unknown): ProjectMutationRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object' || !('draft' in input))
    throw new PublicIpcError('invalid-request')
  return { ...precondition, draft: (input as ProjectMutationRequest).draft }
}

async function chooseAndSaveAs(
  senderId: number,
  controller: WorkspaceController,
  request: ProjectMutationRequest,
) {
  const window = BrowserWindow.getAllWindows().find(
    (candidate) => candidate.webContents.id === senderId,
  )
  const result = await dialog.showSaveDialog(window ?? BrowserWindow.getFocusedWindow()!, {
    title: `Save ${APP_NAME} Project`,
    defaultPath: `Untitled${APP_FILE_EXT}`,
  })
  if (result.canceled || !result.filePath) return null
  const destination = result.filePath.endsWith(APP_FILE_EXT)
    ? result.filePath
    : `${result.filePath}${APP_FILE_EXT}`
  return controller.saveAs(destination, request)
}
