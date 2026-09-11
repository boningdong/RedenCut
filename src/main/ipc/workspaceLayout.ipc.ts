import { ipcMain } from 'electron'
import { WorkspaceLayoutSchema } from '../../shared/workspaceLayout.types'
import type { WorkspaceLayoutStore } from '../preferences/WorkspaceLayoutStore'
import { toIpcResult } from './ipcResult'

export function registerWorkspaceLayoutIpc(
  store: WorkspaceLayoutStore,
  diagnosticSink: (error: unknown) => void = console.error,
): void {
  ipcMain.handle('workspace-layout:get', () => toIpcResult(() => store.read(), diagnosticSink))
  ipcMain.handle('workspace-layout:set', (_event, input: unknown) =>
    toIpcResult(() => store.write(WorkspaceLayoutSchema.parse(input)), diagnosticSink),
  )
}
