// ─────────────────────────────────────────────────────────────────────────────
// Project IPC Handlers
//
// Handles opening, saving, and saving-as .podcut project files.
// Project files are JSON that conform to the ProjectFileSchema (Zod-validated
// on load to catch corruption or version mismatches early).
// ─────────────────────────────────────────────────────────────────────────────

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { ProjectFileSchema } from '../../shared/project.types'
import { APP_FILE_EXT, APP_NAME } from '../../shared/constants'

// ── Channel: project:open-dialog ──────────────────────────────────────────────
// Shows a native open dialog filtered to .podcut files.
// Reads and Zod-validates the file.
// Returns { projectPath, project } or null if cancelled.
ipcMain.handle('project:open-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
    title: `Open ${APP_NAME} Project`,
    filters: [
      { name: `${APP_NAME} Project`, extensions: [APP_FILE_EXT.slice(1)] }, // strip the leading dot
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })

  if (result.canceled || result.filePaths.length === 0) return null

  const projectPath = result.filePaths[0]
  const raw = await readFile(projectPath, 'utf-8')
  const json = JSON.parse(raw)

  // Zod parse — throws ZodError (with clear field paths) on invalid data
  const project = ProjectFileSchema.parse(json)

  return { projectPath, project }
})

// ── Channel: project:save ─────────────────────────────────────────────────────
// Writes a ProjectFile to the given path as formatted JSON.
ipcMain.handle('project:save', async (_event, project: unknown, filePath: string) => {
  // Validate before writing — prevents persisting a corrupted state
  const validated = ProjectFileSchema.parse(project)
  const json = JSON.stringify(validated, null, 2)
  await writeFile(filePath, json, 'utf-8')
})

// ── Channel: project:save-as ──────────────────────────────────────────────────
// Opens a native Save As dialog, then writes the file.
// Returns the chosen path, or null if cancelled.
ipcMain.handle('project:save-as', async (event, project: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender)

  const result = await dialog.showSaveDialog(win ?? BrowserWindow.getFocusedWindow()!, {
    title: `Save ${APP_NAME} Project`,
    defaultPath: `Untitled${APP_FILE_EXT}`,
    filters: [{ name: `${APP_NAME} Project`, extensions: [APP_FILE_EXT.slice(1)] }],
  })

  if (result.canceled || !result.filePath) return null

  const validated = ProjectFileSchema.parse(project)
  const json = JSON.stringify(validated, null, 2)
  await writeFile(result.filePath, json, 'utf-8')

  return result.filePath
})
