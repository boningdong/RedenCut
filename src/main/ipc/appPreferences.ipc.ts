import { BrowserWindow, ipcMain } from 'electron'
import {
  LocalePreferenceSchema,
  ThemeIdSchema,
  OnboardingDispositionSchema,
  FeaturePreferencesSchema,
} from '../../shared/appPreferences.types'
import type { AppPreferencesStore } from '../preferences/AppPreferencesStore'
import { toIpcResult } from './ipcResult'

export function registerAppPreferencesIpc(
  store: AppPreferencesStore,
  diagnosticSink: (error: unknown) => void = console.error,
): void {
  ipcMain.handle('app-preferences:get', () => toIpcResult(() => store.read(), diagnosticSink))
  const broadcast = async (
    operation: () => Promise<ReturnType<AppPreferencesStore['getSnapshot']>>,
  ) => {
    const snapshot = await operation()
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      try {
        window.webContents.send('app-preferences:changed', snapshot)
      } catch (error) {
        diagnosticSink(error)
      }
    }
    return snapshot
  }
  ipcMain.handle('app-preferences:set-theme', (_event, input: unknown) =>
    toIpcResult(() => broadcast(() => store.setTheme(ThemeIdSchema.parse(input))), diagnosticSink),
  )
  ipcMain.handle('app-preferences:migrate-theme', (_event, input: unknown) =>
    toIpcResult(
      () => broadcast(() => store.migrateTheme(ThemeIdSchema.parse(input))),
      diagnosticSink,
    ),
  )
  ipcMain.handle('app-preferences:set-features', (_event, input: unknown) =>
    toIpcResult(
      () => broadcast(() => store.setFeaturePreferences(FeaturePreferencesSchema.parse(input))),
      diagnosticSink,
    ),
  )
  ipcMain.handle('app-preferences:set-onboarding', (_event, input: unknown) =>
    toIpcResult(
      () =>
        broadcast(() => store.setOnboardingDisposition(OnboardingDispositionSchema.parse(input))),
      diagnosticSink,
    ),
  )
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
