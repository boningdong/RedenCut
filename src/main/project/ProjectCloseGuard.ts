import { randomUUID } from 'node:crypto'
import type { ProjectCloseRequest } from '../../shared/ProjectCommands'

interface CloseSender {
  id: number
  isDestroyed(): boolean
  isCrashed?(): boolean
  send(channel: string, value: ProjectCloseRequest): void
  once(event: 'destroyed' | 'render-process-gone', listener: () => void): unknown
  removeListener(event: 'destroyed' | 'render-process-gone', listener: () => void): unknown
}

/** A native close must wait for the renderer's save/discard/cancel transition. */
export class ProjectCloseGuard {
  private pending = new Map<
    number,
    { requestId: string; promise: Promise<boolean>; finish(value: boolean): void }
  >()

  request(sender: CloseSender): Promise<boolean> {
    const existing = this.pending.get(sender.id)
    if (existing) return existing.promise
    if (sender.isDestroyed() || sender.isCrashed?.()) return Promise.resolve(false)
    const requestId = randomUUID()
    let resolve!: (value: boolean) => void
    const promise = new Promise<boolean>((done) => {
      resolve = done
    })
    const lost = () => finish(false)
    // Native save dialogs may remain open indefinitely; renderer loss settles immediately.
    const finish = (value: boolean) => {
      if (!this.pending.delete(sender.id)) return
      sender.removeListener('destroyed', lost)
      sender.removeListener('render-process-gone', lost)
      resolve(value)
    }
    this.pending.set(sender.id, { requestId, promise, finish })
    sender.once('destroyed', lost)
    sender.once('render-process-gone', lost)
    try {
      sender.send('project:close-request', { requestId })
    } catch {
      finish(false)
    }
    return promise
  }

  respond(senderId: number, requestId: string, allowed: boolean): boolean {
    const pending = this.pending.get(senderId)
    if (!pending || pending.requestId !== requestId) return false
    pending.finish(allowed)
    return true
  }
}
