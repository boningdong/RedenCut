export class AsyncMutex {
  private locked = false
  private readonly waiters: Array<{
    enter: () => void
    abort: () => void
  }> = []

  async runExclusive<T>(operation: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)
    try {
      return await operation()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError())
    if (!this.locked) {
      this.locked = true
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        enter: () => {
          signal?.removeEventListener('abort', waiter.abort)
          resolve()
        },
        abort: () => {
          const index = this.waiters.indexOf(waiter)
          if (index < 0) return
          this.waiters.splice(index, 1)
          signal?.removeEventListener('abort', waiter.abort)
          reject(abortError())
        },
      }
      this.waiters.push(waiter)
      if (signal) {
        if (signal.aborted) {
          waiter.abort()
          return
        }
        signal.addEventListener('abort', waiter.abort, { once: true })
        if (signal.aborted) waiter.abort()
      }
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next.enter()
    else this.locked = false
  }
}

function abortError(): DOMException {
  return new DOMException('Mutex acquisition aborted', 'AbortError')
}
