import { deadline } from './deadline'

export class OperationGate {
  private tail: Promise<void> = Promise.resolve()
  private transitioning = false

  runUi<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transitioning) return Promise.reject(new Error('LIFECYCLE_BUSY'))
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => {},
      () => {},
    )
    return result
  }

  async runLifecycle<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.transitioning) throw new Error('LIFECYCLE_BUSY')
    this.transitioning = true
    try {
      await deadline(this.tail, timeoutMs, 'UI_DRAIN_TIMEOUT')
      return await operation()
    } finally {
      this.transitioning = false
    }
  }
}
