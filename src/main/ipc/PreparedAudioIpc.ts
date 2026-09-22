import { ipcMain } from 'electron'
import { ProjectFileSchema } from '../../shared/ProjectTypes'
import { buildAudioRenderPlan } from '../../shared/audio/AudioRenderPlanBuilder'
import { PreparedTrackService } from '../audio/effects/PreparedTrackService'
import type { WorkspaceController } from '../project/WorkspaceController'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

export function registerPreparedAudioIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
): void {
  const leases = new Map<string, { service: PreparedTrackService; dispose: () => Promise<void> }>()
  const leaseKey = (senderId: number, workspaceToken: string, requestId: string) =>
    JSON.stringify([senderId, workspaceToken, requestId])
  ipcMain.handle('effects:prepare', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = requireSessionPrecondition(input)
      controller.assertCurrent(request)
      const candidate = input as Record<string, unknown>
      const requestId = requireJobId(candidate.requestId)
      if (
        typeof candidate.trackId !== 'string' ||
        !['timeline', 'edited'].includes(String(candidate.mode))
      )
        throw new PublicIpcError('invalid-request')
      const project = ProjectFileSchema.parse({
        ...controller.workspace.project,
        tracks: candidate.tracks,
      })
      const tracks = project.tracks
      const plan = buildAudioRenderPlan(tracks, candidate.mode as 'timeline' | 'edited')
      const track = plan.tracks.find((track) => track.trackId === candidate.trackId)
      if (!track?.normalize || plan.durationFrames <= 0) throw new PublicIpcError('invalid-request')
      const resolveOriginal = controller.captureOriginalResolver(request)
      const sources = controller.workspace.project.audioSources
      const key = leaseKey(event.sender.id, request.workspaceToken, requestId)
      let lease = leases.get(key)
      if (!lease) {
        const service = new PreparedTrackService()
        let unregister = () => {}
        const dispose = async () => {
          leases.delete(key)
          event.sender.removeListener('destroyed', onDestroyed)
          try {
            await service.dispose()
          } finally {
            unregister()
          }
        }
        const onDestroyed = () => {
          void dispose().catch(console.error)
        }
        unregister = jobs.register(
          { kind: 'effects', ...request, senderId: event.sender.id, jobId: requestId },
          () => ({ cancel: dispose, settled: Promise.resolve() }),
        )
        lease = { service, dispose }
        leases.set(key, lease)
        event.sender.once('destroyed', onDestroyed)
      }
      const result = await lease.service.prepare(
        { ...plan, tracks: [track] },
        candidate.mode as 'timeline' | 'edited',
        sources,
        resolveOriginal,
      )
      controller.assertCurrent(request)
      return result
    }, console.error),
  )
  ipcMain.handle('effects:read', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = requireSessionPrecondition(input)
      controller.assertCurrent(request)
      const candidate = input as Record<string, unknown>
      const key = leaseKey(
        event.sender.id,
        request.workspaceToken,
        requireJobId(candidate.requestId),
      )
      const lease = leases.get(key)
      if (
        !lease ||
        typeof candidate.handle !== 'string' ||
        typeof candidate.startFrame !== 'number' ||
        typeof candidate.frameCount !== 'number'
      )
        throw new PublicIpcError('invalid-request')
      const result = await lease.service.read(
        candidate.handle,
        candidate.startFrame,
        candidate.frameCount,
      )
      controller.assertCurrent(request)
      return result
    }, console.error),
  )
  ipcMain.handle('effects:release', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = requireSessionPrecondition(input)
      const candidate = input as Record<string, unknown>
      const key = leaseKey(
        event.sender.id,
        request.workspaceToken,
        requireJobId(candidate.requestId),
      )
      await leases.get(key)?.dispose()
    }, console.error),
  )
}
