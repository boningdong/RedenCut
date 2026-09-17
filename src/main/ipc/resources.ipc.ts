import { ResourcePreparationSchema } from '../../shared/resources.types'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { z } from 'zod'
import type { ResourceManager } from '../resources/ResourceManager'
import { toIpcResult } from './ipcResult'
export function registerResourcesIpc(manager: ResourceManager): void {
  ipcMain.handle('resources:open-guide', (_event, input: unknown) =>
    toIpcResult(() => {
      const guide = z.enum(['tools', 'python']).parse(input)
      return shell.openExternal(
        guide === 'tools'
          ? 'https://brew.sh'
          : 'https://docs.astral.sh/uv/getting-started/installation/',
      )
    }),
  )
  ipcMain.handle('resources:select-whisper', (_event, input: unknown) =>
    toIpcResult(() => manager.selectWhisperModel(z.string().min(1).parse(input))),
  )
  ipcMain.handle('resources:get', () => toIpcResult(() => manager.read()))
  ipcMain.handle('resources:prepare', (_event, input: unknown) =>
    toIpcResult(() => manager.prepare(ResourcePreparationSchema.parse(input))),
  )
  ipcMain.handle('resources:cancel', () => toIpcResult(() => manager.cancel()))
  manager.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        try {
          window.webContents.send('resources:changed', snapshot)
        } catch {
          /* closing */
        }
      }
  })
}
