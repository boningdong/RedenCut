import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { ProjectFileSchema } from '../../shared/ProjectTypes'
import { buildAudioRenderPlan } from '../../shared/audio/AudioRenderPlanBuilder'
import {
  PreparedAudioPool,
  preparedAudioKey,
  type PreparedAudioLease,
} from '../audio/effects/PreparedAudioPool'
import type { WorkspaceController } from '../project/WorkspaceController'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

export function registerPreparedAudioIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
): void {
  const leases = new Map<
    string,
    {
      service: PreparedAudioLease
      pool: PreparedAudioPool
      workspace: WorkspaceController['workspace']
      dispose: () => Promise<void>
    }
  >()
  const pools = new Map<
    string,
    { pool: PreparedAudioPool; workspace: WorkspaceController['workspace'] }
  >()
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
      if (!track || plan.durationFrames <= 0) throw new PublicIpcError('invalid-request')
      const resolveOriginal = controller.captureOriginalResolver(request)
      const sources = controller.workspace.project.audioSources
      const key = leaseKey(event.sender.id, request.workspaceToken, requestId)
      const poolKey = JSON.stringify([event.sender.id, request.workspaceToken])
      let owner = pools.get(poolKey)
      if (!owner) {
        const pool = new PreparedAudioPool()
        const workspace = controller.workspace
        const created = { pool, workspace }
        let unregister = () => {}
        const dispose = () => {
          if (pools.get(poolKey) === created) pools.delete(poolKey)
          for (const [leaseId, lease] of leases) {
            if (lease.pool === pool) {
              leases.delete(leaseId)
              void lease.dispose().catch(console.error)
            }
          }
          event.sender.removeListener('destroyed', onDestroyed)
          const result = pool.dispose()
          void result.then(unregister, unregister)
          return result
        }
        const onDestroyed = () => {
          void dispose().catch(console.error)
        }
        unregister = jobs.register(
          { kind: 'effects', ...request, senderId: event.sender.id, jobId: `pool-${randomUUID()}` },
          () => ({ cancel: dispose, settled: Promise.resolve() }),
        )
        owner = created
        pools.set(poolKey, owner)
        event.sender.once('destroyed', onDestroyed)
      }
      const selectedPlan = { ...plan, tracks: [track] }
      let lease = leases.get(key)
      if (lease && lease.service.key !== preparedAudioKey(selectedPlan, sources)) {
        void lease.dispose().catch(console.error)
        lease = undefined
      }
      if (!lease) {
        // Register admission even when the pool already exists: a closing workspace
        // must not acquire new consumers between beginClosing and pool cancellation.
        let release = async () => {}
        const unregister = jobs.register(
          {
            kind: 'effects',
            ...request,
            senderId: event.sender.id,
            jobId: `lease-${randomUUID()}`,
          },
          () => ({ cancel: () => release(), settled: Promise.resolve() }),
        )
        let service: PreparedAudioLease
        try {
          service = owner.pool.acquire(
            selectedPlan,
            candidate.mode as 'timeline' | 'edited',
            sources,
            resolveOriginal,
          )
        } catch (error) {
          unregister()
          throw error
        }
        const created = {
          service,
          pool: owner.pool,
          workspace: owner.workspace,
          dispose: async () => {
            if (leases.get(key) === created) leases.delete(key)
            unregister()
            await service.release()
          },
        }
        release = created.dispose
        lease = created
        leases.set(key, lease)
      }
      let result
      try {
        result = await lease.service.result
      } catch (error) {
        await lease.dispose()
        throw error
      }
      // An ordinary save advances revision without changing immutable PCM composition.
      // The admitted lease and exact workspace still guard project switches and disposal.
      if (leases.get(key) !== lease || controller.workspace !== lease.workspace)
        throw new PublicIpcError('stale-session')
      return result
    }, console.error),
  )
  ipcMain.handle('effects:read', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = requireSessionPrecondition(input)
      const candidate = input as Record<string, unknown>
      const key = leaseKey(
        event.sender.id,
        request.workspaceToken,
        requireJobId(candidate.requestId),
      )
      const lease = leases.get(key)
      if (
        !lease ||
        controller.workspace !== lease.workspace ||
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
      // An ordinary save advances revision without changing immutable PCM composition.
      // The admitted lease and exact workspace still guard project switches and disposal.
      if (leases.get(key) !== lease || controller.workspace !== lease.workspace)
        throw new PublicIpcError('stale-session')
      return result
    }, console.error),
  )
  ipcMain.handle('effects:waveform', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = requireSessionPrecondition(input)
      const candidate = input as Record<string, unknown>
      const key = leaseKey(
        event.sender.id,
        request.workspaceToken,
        requireJobId(candidate.requestId),
      )
      const lease = leases.get(key)
      if (
        !lease ||
        controller.workspace !== lease.workspace ||
        typeof candidate.handle !== 'string' ||
        typeof candidate.startFrame !== 'number' ||
        typeof candidate.endFrame !== 'number' ||
        typeof candidate.targetBuckets !== 'number'
      )
        throw new PublicIpcError('invalid-request')
      const result = await lease.service.waveform(
        candidate.handle,
        candidate.startFrame,
        candidate.endFrame,
        candidate.targetBuckets,
      )
      if (leases.get(key) !== lease || controller.workspace !== lease.workspace)
        throw new PublicIpcError('stale-session')
      return result
    }, console.error),
  )
  ipcMain.handle('effects:progress', (event, input: unknown) =>
    toIpcResult(async () => {
      const request = requireSessionPrecondition(input)
      const key = leaseKey(
        event.sender.id,
        request.workspaceToken,
        requireJobId((input as Record<string, unknown>).requestId),
      )
      const lease = leases.get(key)
      if (!lease || controller.workspace !== lease.workspace) return null
      return lease.service.progress()
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
