import { appLogger } from '../logging/AppLogger'
import { dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { DiagnosticReport } from '../diagnostics/DiagnosticReport'
import { ReportSaveError } from '../diagnostics/DiagnosticReport'
import {
  DiagnosticChannels,
  DiagnosticCollectionRequestSchema,
} from '../../shared/DiagnosticBundleTypes'
import { createTranslator } from '../../shared/i18n/createTranslator'
import type { Locale } from '../../shared/i18n/locale.types'
import { toIpcResult } from './ipcResult'

export function registerDiagnosticsIpc(
  reports: DiagnosticReport,
  chooseDestination?: () => Promise<string | null>,
  getLocale: () => Locale = () => 'en',
): void {
  const owners = new Set<number>()
  ipcMain.handle(DiagnosticChannels.Preview, (event, input: unknown) =>
    toIpcResult(() => {
      const id = event.sender.id
      if (!owners.has(id)) {
        owners.add(id)
        event.sender.once('destroyed', () => {
          owners.delete(id)
          void reports.releaseOwner(id).catch(appLogger.reportError)
        })
      }
      return reports.previewReport(DiagnosticCollectionRequestSchema.parse(input), id)
    }),
  )
  const validate = (event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== 'string') throw new Error('Invalid diagnostic preview')
    reports.snapshotPath(input, event.sender.id)
    return input
  }
  ipcMain.handle(DiagnosticChannels.Save, (event, previewId: unknown) =>
    toIpcResult(async () => {
      const id = validate(event, previewId)
      const locale = getLocale()
      const t = createTranslator(locale).getFixedT(locale)
      const destination = chooseDestination
        ? await chooseDestination()
        : await dialog
            .showSaveDialog({
              title: t('diagnostics.save'),
              defaultPath: reports.suggestedFilename(id, event.sender.id),
              filters: [{ name: 'ZIP', extensions: ['zip'] }],
            })
            .then((choice) => (choice.canceled ? null : (choice.filePath ?? null)))
      if (!destination) return { status: 'cancelled' as const }
      try {
        await reports.saveReport(id, destination, event.sender.id)
      } catch {
        throw new ReportSaveError()
      }
      return { status: 'saved' as const }
    }),
  )
  ipcMain.handle(DiagnosticChannels.ShowSaved, (event, previewId: unknown) =>
    toIpcResult(() => {
      const id = validate(event, previewId)
      const path = reports.savedPath(id, event.sender.id)
      if (!path) throw new Error('Report has not been saved')
      shell.showItemInFolder(path)
    }),
  )
  ipcMain.handle(DiagnosticChannels.Inspect, (event, previewId: unknown) =>
    toIpcResult(async () => {
      const id = validate(event, previewId)
      await reports.inspectReport(id, event.sender.id, async (path) => {
        const failure = await shell.openPath(path)
        if (failure) throw new Error('Could not open diagnostic snapshot')
      })
    }),
  )
  ipcMain.handle(DiagnosticChannels.Release, (event, previewId: unknown) =>
    toIpcResult(() => {
      if (typeof previewId !== 'string') throw new Error('Invalid diagnostic preview')
      return reports.releaseReport(previewId, event.sender.id)
    }),
  )
}
