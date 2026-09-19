import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { AudioSource } from '../../shared/ProjectTypes'
import type { MediaRecoverySnapshot } from '../../shared/MediaRecoveryTypes'
import type { ProjectSwitchSender } from './SessionSwitchBarrier'
import { MediaRecoveryError, type MediaRecoveryService } from './MediaRecoveryService'

interface Recovery {
  sender: ProjectSwitchSender
  root: string
  sources: AudioSource[]
  snapshot: MediaRecoverySnapshot
  abort: AbortController
  active: Promise<void> | null
  closing: boolean
  cancellation: Promise<void> | null
  resolve: (proceed: boolean) => void
  onDestroyed: () => void
}

export class MediaRecoveryCoordinator {
  private shuttingDown = false
  private readonly recoveries = new Map<string, Recovery>()
  constructor(
    private readonly service: Pick<MediaRecoveryService, 'findMissing' | 'restore'>,
    private readonly choose: (sender: ProjectSwitchSender) => Promise<string | null>,
    private readonly publish: (senderId: number, snapshot: MediaRecoverySnapshot) => void,
  ) {}

  async recover(
    sender: ProjectSwitchSender,
    root: string,
    sources: AudioSource[],
  ): Promise<boolean> {
    let invalidated = false
    const invalidate = () => {
      invalidated = true
    }
    const lifecycleEvents = ['destroyed', 'did-start-loading', 'render-process-gone'] as const
    lifecycleEvents.forEach((event) => sender.once(event, invalidate))
    let missing: AudioSource[]
    try {
      missing = await this.service.findMissing(root, sources)
    } finally {
      lifecycleEvents.forEach((event) => sender.removeListener(event, invalidate))
    }
    if (invalidated || this.shuttingDown || sender.isDestroyed()) return false
    if (!missing.length) return true
    return new Promise<boolean>((resolve) => {
      const recoveryId = randomUUID()
      const recovery: Recovery = {
        sender,
        root,
        sources: missing,
        abort: new AbortController(),
        active: null,
        closing: false,
        cancellation: null,
        resolve,
        onDestroyed: () => {
          void this.cancel(sender.id, recoveryId)
        },
        snapshot: {
          recoveryId,
          revision: 0,
          projectDisplayName: basename(root),
          status: 'active',
          items: missing.map((source) => ({
            audioSourceId: source.id,
            displayName: source.displayName,
            metadata: source.metadata,
            byteLength: source.fingerprint.byteLength,
            state: { status: 'missing' },
          })),
        },
      }
      this.recoveries.set(recoveryId, recovery)
      sender.once('destroyed', recovery.onDestroyed)
      sender.once('did-start-loading', recovery.onDestroyed)
      sender.once('render-process-gone', recovery.onDestroyed)
      this.emit(recovery)
    })
  }

  async locate(senderId: number, id: string, audioSourceId: string): Promise<void> {
    const recovery = this.require(senderId, id)
    if (recovery.active) throw new Error('Media recovery is busy')
    const item = recovery.snapshot.items.find((item) => item.audioSourceId === audioSourceId)
    const source = recovery.sources.find((source) => source.id === audioSourceId)
    if (!item || !source || item.state.status === 'restored')
      throw new Error('Invalid recovery source')
    const previous = item.state
    item.state = { status: 'selecting' }
    this.emit(recovery)
    const operation = (async () => {
      try {
        const path = await this.choose(recovery.sender)
        if (recovery.abort.signal.aborted) return
        if (!path) {
          item.state = previous
          return
        }
        item.state = {
          status: 'restoring',
          processedBytes: 0,
          totalBytes: source.fingerprint.byteLength,
        }
        this.emit(recovery)
        let lastUpdate = 0
        await this.service.restore(recovery.root, source, path, recovery.abort.signal, (bytes) => {
          if (recovery.closing) return
          item.state = {
            status: 'restoring',
            processedBytes: bytes,
            totalBytes: source.fingerprint.byteLength,
          }
          if (Date.now() - lastUpdate >= 100) {
            lastUpdate = Date.now()
            this.emit(recovery)
          }
        })
        item.state = { status: 'restored' }
      } catch (error) {
        if (recovery.abort.signal.aborted) return
        const reason = error instanceof MediaRecoveryError ? error.reason : 'read-failed'
        item.state = { status: 'failed', reason: reason ?? 'read-failed' }
      } finally {
        recovery.active = null
        if (!recovery.closing) this.emit(recovery)
      }
    })()
    recovery.active = operation
    await operation
  }

  continue(senderId: number, id: string): void {
    const recovery = this.require(senderId, id)
    if (recovery.active || recovery.snapshot.items.some((item) => item.state.status !== 'restored'))
      throw new Error('Media recovery is incomplete')
    this.finish(recovery, true)
  }

  async cancel(senderId: number, id: string): Promise<void> {
    const recovery = this.recoveries.get(id)
    if (!recovery || recovery.sender.id !== senderId) return
    if (recovery.cancellation) return recovery.cancellation
    recovery.closing = true
    recovery.abort.abort()
    recovery.cancellation = (async () => {
      // A picker cannot publish after abort; a copy must settle and clean staging before releasing the open transaction.
      const copying = recovery.snapshot.items.some((item) => item.state.status === 'restoring')
      if (copying) await recovery.active
      this.finish(recovery, false)
    })()
    return recovery.cancellation
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    await Promise.all([...this.recoveries.entries()].map(([id, r]) => this.cancel(r.sender.id, id)))
  }
  private require(senderId: number, id: string): Recovery {
    const recovery = this.recoveries.get(id)
    if (!recovery || recovery.sender.id !== senderId || recovery.closing)
      throw new Error('Invalid media recovery')
    return recovery
  }
  private finish(recovery: Recovery, proceed: boolean): void {
    recovery.closing = true
    this.recoveries.delete(recovery.snapshot.recoveryId)
    recovery.sender.removeListener('destroyed', recovery.onDestroyed)
    recovery.sender.removeListener('did-start-loading', recovery.onDestroyed)
    recovery.sender.removeListener('render-process-gone', recovery.onDestroyed)
    recovery.snapshot.status = 'closed'
    this.emit(recovery)
    recovery.resolve(proceed)
  }
  private emit(recovery: Recovery): void {
    recovery.snapshot.revision++
    if (!recovery.sender.isDestroyed())
      this.publish(recovery.sender.id, structuredClone(recovery.snapshot))
  }
}

export class MediaRecoveryCancelled extends Error {}
