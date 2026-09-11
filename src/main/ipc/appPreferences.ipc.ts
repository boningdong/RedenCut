import { BrowserWindow, ipcMain } from 'electron'
import { LocalePreferenceSchema } from '../../shared/appPreferences.types'
import type { AppPreferencesStore } from '../preferences/AppPreferencesStore'
import { toIpcResult } from './ipcResult'

export function registerAppPreferencesIpc(
  store: AppPreferencesStore,
  diagnosticSink: (error: unknown) => void = console.error,
): void {
  ipcMain.handle('app-preferences:get', () => toIpcResult(() => store.read(), diagnosticSink))
  ipcMain.handle('app-preferences:set-locale', (_event, input: unknown) =>
    toIpcResult(async () => {
      const snapshot = await store.setLocale(LocalePreferenceSchema.parse(input))
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed() || window.webContents.isDestroyed()) continue
        try {
          window.webContents.send('app-preferences:changed', snapshot)
        } catch (error) {
          // A window can close after the liveness check; persistence already succeeded.
          diagnosticSink(error)
        }
      }
      return snapshot
    }, diagnosticSink),
  )
}
