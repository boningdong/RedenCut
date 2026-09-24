import { dialog, ipcMain, shell } from 'electron'
import type { DiagnosticReport } from '../diagnostics/DiagnosticReport'
import { ReportSaveError } from '../diagnostics/DiagnosticReport'
import { toIpcResult } from './ipcResult'

export function registerDiagnosticsIpc(
  reports: DiagnosticReport,
  chooseDestination?: () => Promise<string | null>,
): void {
  ipcMain.handle('diagnostics:recent-failure', () => toIpcResult(() => reports.recentFailure()))
  ipcMain.handle('diagnostics:preview', (_event, input: unknown) =>
    toIpcResult(() => {
      if (
        !input ||
        typeof input !== 'object' ||
        !Array.isArray((input as { diagnosticIds?: unknown }).diagnosticIds)
      )
        throw new Error('Invalid diagnostic report request')
      return reports.previewReport({
        diagnosticIds: (input as { diagnosticIds: string[] }).diagnosticIds,
      })
    }),
  )
  ipcMain.handle('diagnostics:save', (_event, previewId: unknown) =>
    toIpcResult(async () => {
      if (typeof previewId !== 'string') throw new Error('Invalid report preview')
      const destination = chooseDestination
        ? await chooseDestination()
        : await dialog
            .showSaveDialog({
              title: 'Save Diagnostic Report',
              defaultPath: reports.suggestedFilename(previewId),
              filters: [{ name: 'JSON', extensions: ['json'] }],
            })
            .then((choice) => (choice.canceled ? null : (choice.filePath ?? null)))
      if (!destination) return { status: 'cancelled' as const }
      try {
        await reports.saveReport(previewId, destination)
      } catch {
        throw new ReportSaveError()
      }
      return { status: 'saved' as const }
    }),
  )
  ipcMain.handle('diagnostics:show-saved', (_event, previewId: unknown) =>
    toIpcResult(() => {
      if (typeof previewId !== 'string') throw new Error('Invalid report preview')
      const path = reports.savedPath(previewId)
      if (!path) throw new Error('Report has not been saved')
      shell.showItemInFolder(path)
    }),
  )
}
