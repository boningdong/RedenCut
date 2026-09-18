import { ipcMain } from 'electron'
import { z } from 'zod'
import { AudioSourceIdSchema } from '../../shared/project.types'
import type { MediaRecoveryCoordinator } from '../project/MediaRecoveryCoordinator'
import { PublicIpcError, toIpcResult } from './ipcResult'
const requestSchema = z.object({ recoveryId: z.string().uuid() })
const locateSchema = requestSchema.extend({ audioSourceId: AudioSourceIdSchema })
export function registerMediaRecoveryIpc(coordinator: MediaRecoveryCoordinator): void {
  ipcMain.handle('media-recovery:locate', (event, input: unknown) =>
    toIpcResult(async () => {
      const parsed = locateSchema.safeParse(input)
      if (!parsed.success) throw new PublicIpcError('invalid-request')
      await coordinator.locate(event.sender.id, parsed.data.recoveryId, parsed.data.audioSourceId)
    }),
  )
  ipcMain.handle('media-recovery:continue', (event, input: unknown) =>
    toIpcResult(() => {
      const parsed = requestSchema.safeParse(input)
      if (!parsed.success) throw new PublicIpcError('invalid-request')
      coordinator.continue(event.sender.id, parsed.data.recoveryId)
    }),
  )
  ipcMain.handle('media-recovery:cancel', (event, input: unknown) =>
    toIpcResult(async () => {
      const parsed = requestSchema.safeParse(input)
      if (!parsed.success) throw new PublicIpcError('invalid-request')
      await coordinator.cancel(event.sender.id, parsed.data.recoveryId)
    }),
  )
}
