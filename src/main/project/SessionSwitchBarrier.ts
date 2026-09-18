import { randomUUID } from 'crypto'
import type { SessionPrecondition } from '../../shared/session.types'

export interface ProjectSwitchAcknowledgement extends SessionPrecondition {
  transitionId: string
}

export interface ProjectSwitchSender {
  id: number
  send(channel: string, value: ProjectSwitchAcknowledgement): void
  isDestroyed(): boolean
  once(event: 'destroyed' | 'did-start-loading' | 'render-process-gone', listener: () => void): void
  removeListener(
    event: 'destroyed' | 'did-start-loading' | 'render-process-gone',
    listener: () => void,
  ): void
}

interface PendingBarrier extends ProjectSwitchAcknowledgement {
  senderId: number
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  sender: ProjectSwitchSender
  onDestroyed: () => void
}

interface SessionSwitchBarrierOptions {
  createId?: () => string
  timeoutMs?: number
}

export class ProjectSwitchShutdownError extends Error {
  constructor() {
    super('Project switch was interrupted by application shutdown')
    this.name = 'ProjectSwitchShutdownError'
  }
}

export class SessionSwitchBarrier {
  private readonly pending = new Map<string, PendingBarrier>()
  private readonly createId: () => string
  private readonly timeoutMs: number
  private shuttingDown = false

  constructor(options: SessionSwitchBarrierOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.timeoutMs = options.timeoutMs ?? 5_000
  }

  wait(sender: ProjectSwitchSender, session: SessionPrecondition): Promise<void> {
    if (this.shuttingDown) return Promise.reject(new ProjectSwitchShutdownError())
    if (sender.isDestroyed())
      return Promise.reject(new Error('Project switch sender was destroyed'))
    const transitionId = this.createId()
    return new Promise<void>((resolve, reject) => {
      const onDestroyed = () => this.reject(transitionId, 'Project switch sender was destroyed')
      const timeout = setTimeout(
        () => this.reject(transitionId, 'Project switch was not acknowledged'),
        this.timeoutMs,
      )
      const pending: PendingBarrier = {
        transitionId,
        ...session,
        senderId: sender.id,
        resolve,
        reject,
        timeout,
        sender,
        onDestroyed,
      }
      this.pending.set(transitionId, pending)
      sender.once('destroyed', onDestroyed)
      try {
        sender.send('project:will-switch', { transitionId, ...session })
      } catch (error) {
        this.settle(pending)
        reject(error instanceof Error ? error : new Error('Project switch request failed'))
      }
    })
  }

  acknowledge(senderId: number, acknowledgement: ProjectSwitchAcknowledgement): boolean {
    const pending = this.pending.get(acknowledgement.transitionId)
    if (
      !pending ||
      pending.senderId !== senderId ||
      pending.workspaceToken !== acknowledgement.workspaceToken ||
      pending.revision !== acknowledgement.revision
    )
      return false
    this.settle(pending)
    pending.resolve()
    return true
  }

  shutdown(): void {
    this.shuttingDown = true
    for (const pending of [...this.pending.values()]) {
      this.settle(pending)
      pending.reject(new ProjectSwitchShutdownError())
    }
  }

  private reject(transitionId: string, message: string): void {
    const pending = this.pending.get(transitionId)
    if (!pending) return
    this.settle(pending)
    pending.reject(new Error(message))
  }

  private settle(pending: PendingBarrier): void {
    this.pending.delete(pending.transitionId)
    clearTimeout(pending.timeout)
    pending.sender.removeListener('destroyed', pending.onDestroyed)
  }
}
