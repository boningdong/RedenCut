import { ipcMain } from 'electron'
import { RenameSpeakerRequestSchema } from '../../shared/speakerLabel.types'
import type { WorkspaceController } from '../project/WorkspaceController'
import { toIpcResult } from './ipcResult'

export function registerSpeakerLabelIpc(
  controller: WorkspaceController,
  diagnosticSink: (error: unknown) => void = console.error,
): void {
  ipcMain.handle('speaker-label:rename', (_event, input: unknown) =>
    toIpcResult(
      () => controller.renameSpeaker(RenameSpeakerRequestSchema.parse(input)),
      diagnosticSink,
    ),
  )
}
