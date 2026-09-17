import { ipcMain } from 'electron'
import { SaveSpeakerIdentitiesRequestSchema } from '../../shared/SpeakerIdentityTypes'
import type { WorkspaceController } from '../project/WorkspaceController'
import { toIpcResult } from './ipcResult'
export function registerSpeakerIdentityIpc(
  controller: WorkspaceController,
  diagnosticSink: (error: unknown) => void = console.error,
): void {
  ipcMain.handle('speaker-identity:save', (_event, input: unknown) =>
    toIpcResult(
      () => controller.saveSpeakerIdentities(SaveSpeakerIdentitiesRequestSchema.parse(input)),
      diagnosticSink,
    ),
  )
}
