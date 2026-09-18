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
  store.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      try {
        window.webContents.send('app-preferences:changed', snapshot)
      } catch (error) {
        diagnosticSink(error)
      }
    }
  })
  ipcMain.handle('app-preferences:set-theme', (_event, input: unknown) =>
    toIpcResult(() => store.setTheme(ThemeIdSchema.parse(input)), diagnosticSink),
  )
  ipcMain.handle('app-preferences:migrate-theme', (_event, input: unknown) =>
    toIpcResult(() => store.migrateTheme(ThemeIdSchema.parse(input)), diagnosticSink),
  )
  ipcMain.handle('app-preferences:set-features', (_event, input: unknown) =>
    toIpcResult(
      () => store.setFeaturePreferences(FeaturePreferencesSchema.parse(input)),
      diagnosticSink,
    ),
  )
  ipcMain.handle('app-preferences:set-onboarding', (_event, input: unknown) =>
    toIpcResult(
      () => store.setOnboardingDisposition(OnboardingDispositionSchema.parse(input)),
      diagnosticSink,
    ),
  )
  ipcMain.handle('app-preferences:set-locale', (_event, input: unknown) =>
    toIpcResult(() => store.setLocale(LocalePreferenceSchema.parse(input)), diagnosticSink),
  )
}
