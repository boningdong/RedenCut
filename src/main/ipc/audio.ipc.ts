import { randomUUID } from 'crypto'
import { basename } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ImportMode } from '../../shared/import.types'
import { ProjectFileSchema } from '../../shared/project.types'
import { ImportCoordinator } from '../audio/import/ImportCoordinator'
import type { WorkspaceController } from '../project/WorkspaceController'

export function registerAudioIpc(controller: WorkspaceController): void {
  const selections = new Map<string, { senderId: number; path: string; expiresAt: number }>()
  const senderSelections = new Map<number, string>()
  let coordinator = new ImportCoordinator(controller.workspace)
  let coordinatorRoot = controller.workspace.root

  ipcMain.handle('audio:select-import-file', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()!
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
      expiresAt: Date.now() + 10 * 60 * 1000,
    })
    senderSelections.set(event.sender.id, token)
    event.sender.once('destroyed', () => {
      const active = senderSelections.get(event.sender.id)
      if (active) selections.delete(active)
      senderSelections.delete(event.sender.id)
    })
    return { token, displayName: basename(result.filePaths[0]) }
  })

  ipcMain.handle(
    'audio:start-import',
    async (event, importId: string, token: string, mode: ImportMode, project: unknown) => {
      const selection = selections.get(token)
      selections.delete(token)
      if (senderSelections.get(event.sender.id) === token) senderSelections.delete(event.sender.id)
      if (!selection || selection.senderId !== event.sender.id || selection.expiresAt < Date.now())
        throw new Error('Invalid import selection')
      if (controller.workspace.root !== coordinatorRoot) {
        coordinator = new ImportCoordinator(controller.workspace)
        coordinatorRoot = controller.workspace.root
      }
      return coordinator.import(
        importId,
        selection.path,
        mode,
        ProjectFileSchema.parse(project),
        (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send('audio:import-progress', progress)
        },
      )
    },
  )
  ipcMain.handle('audio:cancel-import', (_event, importId: string) => coordinator.cancel(importId))
}
