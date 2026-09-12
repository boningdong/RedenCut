import { randomUUID } from 'crypto'
import { basename } from 'path'

export interface PendingProjectOpen {
  requestId: string
  displayName: string
}

interface PendingProjectOpenSender {
  id: number
  once(event: 'destroyed', listener: () => void): unknown
}

interface PendingEntry {
  senderId: number
  path: string
  expiresAt: number
}

interface PendingProjectOpenRegistryOptions {
  createId?: () => string
  now?: () => number
  ttlMs?: number
}

export class PendingProjectOpenRegistry {
  private readonly entries = new Map<string, PendingEntry>()
  private readonly createId: () => string
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(options: PendingProjectOpenRegistryOptions = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1_000
  }

  issue(senderId: number, path: string): PendingProjectOpen {
    this.sweepExpired()
    const requestId = this.createId()
    this.entries.set(requestId, {
      senderId,
      path,
      expiresAt: this.now() + this.ttlMs,
    })
    return {
      requestId,
      displayName: basename(path, '.riffcut'),
    }
  }

  consume(senderId: number, requestId: string): string {
    this.sweepExpired()
    const entry = this.entries.get(requestId)
    if (!entry || entry.senderId !== senderId) throw new Error('Pending project request is invalid')
    this.entries.delete(requestId)
    return entry.path
  }

  removeSender(senderId: number): void {
    for (const [requestId, entry] of this.entries) {
      if (entry.senderId === senderId) this.entries.delete(requestId)
    }
  }

  private sweepExpired(): void {
    const now = this.now()
    for (const [requestId, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(requestId)
    }
  }
}

export function removePendingProjectOpensOnSenderDestroyed(
  registry: PendingProjectOpenRegistry,
  sender: PendingProjectOpenSender,
): void {
  const senderId = sender.id
  sender.once('destroyed', () => registry.removeSender(senderId))
}
