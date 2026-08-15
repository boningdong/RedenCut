import { BrowserWindow, dialog, ipcMain } from 'electron'
import { APP_FILE_EXT, APP_NAME } from '../../shared/constants'
import { ProjectFileSchema } from '../../shared/project.types'
import type { WorkspaceController } from '../project/WorkspaceController'

export function registerProjectIpc(controller: WorkspaceController): void {
  ipcMain.handle('project:initialize', () => controller.describe())
  ipcMain.handle('project:open-dialog', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
    const result = await dialog.showOpenDialog(window, {
      title: `Open ${APP_NAME} Project`,
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return controller.open(result.filePaths[0])
  })
  ipcMain.handle('project:save', async (event, project: unknown) => {
    const validated = ProjectFileSchema.parse(project)
    if (controller.workspace.descriptor.kind === 'saved') {
      return (await controller.save(validated)).workspace
    }
    return chooseAndSaveAs(event.sender.id, controller, validated)
  })
  ipcMain.handle('project:save-as', async (event, project: unknown) =>
    chooseAndSaveAs(event.sender.id, controller, ProjectFileSchema.parse(project)),
  )
}

async function chooseAndSaveAs(
  senderId: number,
  controller: WorkspaceController,
  project: ReturnType<typeof ProjectFileSchema.parse>,
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
  return (await controller.saveAs(destination, project)).workspace
}
