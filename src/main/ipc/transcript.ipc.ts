import { ipcMain } from 'electron'
import { AudioSourceIdSchema } from '../../shared/project.types'
import { whisperTranscriber } from '../transcriber/whisper'
import type { WorkspaceController } from '../project/WorkspaceController'

export function registerTranscriptIpc(controller: WorkspaceController): void {
  ipcMain.handle('transcript:check-availability', () => whisperTranscriber.unavailableReason())
  ipcMain.handle('transcript:generate', async (event, sourceId: unknown, language?: string) => {
    const path = await controller.resolveOriginal(AudioSourceIdSchema.parse(sourceId))
    return whisperTranscriber.transcribe(path, { language }, (status) => {
      if (!event.sender.isDestroyed()) event.sender.send('transcript:progress', status)
    })
  })
}
