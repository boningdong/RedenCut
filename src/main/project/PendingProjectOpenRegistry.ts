import { randomUUID } from 'crypto'
import { basename } from 'path'

export interface PendingProjectOpen {
  requestId: string
  displayName: string
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
    const requestId = this.createId()
    this.entries.set(requestId, {
      senderId,
      path,
      expiresAt: this.now() + this.ttlMs,
    })
    return {
      requestId,
      displayName: basename(path, '.podcut'),
    }
  }

  consume(senderId: number, requestId: string): string {
    const entry = this.entries.get(requestId)
    if (!entry || entry.senderId !== senderId || entry.expiresAt < this.now()) {
      if (entry?.expiresAt && entry.expiresAt < this.now()) this.entries.delete(requestId)
      throw new Error('Pending project request is invalid')
    }
    this.entries.delete(requestId)
    return entry.path
  }
}
