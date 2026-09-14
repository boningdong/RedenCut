import { MAX_HUGGING_FACE_TOKEN_LENGTH } from '../speech/huggingface/tokenFormat'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { z } from 'zod'
import type { HuggingFaceAccessService } from '../speech/huggingface/HuggingFaceAccessService'
import { toIpcResult } from './ipcResult'
export function registerModelAccessIpc(access: HuggingFaceAccessService): void {
  // Authentication errors must never reach a diagnostic sink with submitted credentials.
  const silent = (): void => {}
  ipcMain.handle('model-access:local', () => toIpcResult(() => access.detectLocal(), silent))
  ipcMain.handle('model-access:verify-local', () => toIpcResult(() => access.verifyLocal(), silent))
  ipcMain.handle('model-access:get', () => toIpcResult(() => access.read(), silent))
  ipcMain.handle('model-access:verify', (_event, input: unknown) =>
    toIpcResult(
      () => access.verify(z.string().max(MAX_HUGGING_FACE_TOKEN_LENGTH).optional().parse(input)),
      silent,
    ),
  )
  ipcMain.handle('model-access:clear', () => toIpcResult(() => access.clear(), silent))
  ipcMain.handle('model-access:open-conditions', () =>
    toIpcResult(() => shell.openExternal(access.conditionsUrl), silent),
  )
  access.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        try {
          window.webContents.send('model-access:changed', snapshot)
        } catch {
          /* closing */
        }
      }
  })
}
