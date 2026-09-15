import type { EventEmitter } from 'events'

interface ProcessStream extends EventEmitter {
  destroy?: () => void
}
interface ManagedChild extends EventEmitter {
  stdin?: ProcessStream | null
  stdout?: ProcessStream | null
  stderr?: ProcessStream | null
  kill(signal?: NodeJS.Signals | number): boolean
}
interface ProcessOptions {
  onStdout?: (chunk: Buffer) => void
  onStderr?: (chunk: Buffer) => void
  terminateGraceMs?: number
  drainGraceMs?: number
}
interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
  diagnostics: string
}

export class ProcessExecutionError extends Error {
  constructor(
    readonly kind: 'startup' | 'process-exit' | 'protocol' | 'unresponsive',
    message: string,
  ) {
    super(message)
    this.name = 'ProcessExecutionError'
  }
}

/** Owns pipes and termination; adapters retain command, protocol and result semantics. */
export function manageProcess<T extends ManagedChild>(
  spawn: () => T,
  signal: AbortSignal,
  options: ProcessOptions = {},
): { child?: T; completed: Promise<ProcessExit>; fail: (error: unknown) => void } {
  const cancelled = () => new DOMException('Speech analysis cancelled', 'AbortError')
  if (signal.aborted) return { completed: Promise.reject(cancelled()), fail: () => {} }
  let child: T
  try {
    child = spawn()
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    Object.assign(failure, { kind: 'startup' })
    return { completed: Promise.reject(failure), fail: () => {} }
  }
  let fail!: (error: unknown) => void
  const completed = new Promise<ProcessExit>((resolve, reject) => {
    let settled = false
    let failure: unknown
    let terminating = false
    let exited = false
    let diagnostics = Buffer.alloc(0)
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    const listeners: Array<() => void> = []
    const listen = <Args extends unknown[]>(
      emitter: EventEmitter | null | undefined,
      event: string,
      handler: (...args: Args) => void,
    ) => {
      if (!emitter) return
      const listener = (...args: unknown[]) => handler(...(args as Args))
      emitter.on(event, listener)
      listeners.push(() => emitter.removeListener(event, listener))
    }
    const finish = (code: number | null, exitSignal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      clearTimeout(drainTimer)
      signal.removeEventListener('abort', abort)
      for (const remove of listeners) remove()
      // A pending pipe write can still report EPIPE after process settlement.
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        if (stream) {
          stream.once('error', () => {})
          stream.destroy?.()
        }
      }
      const text = diagnostics.toString('utf8').trim()
      if (failure !== undefined) {
        if (failure instanceof Error && failure.name !== 'AbortError' && text)
          failure.message += `\nProcess stderr: ${text}`
        reject(failure)
      } else resolve({ code, signal: exitSignal, diagnostics: text })
    }
    fail = (error) => {
      if (settled) return
      failure ??= error instanceof Error ? error : new Error(String(error))
      if (terminating) return
      terminating = true
      if (!exited) child.kill('SIGTERM')
      if (settled) return
      killTimer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL')
        if (settled) return
        drainTimer = setTimeout(() => finish(null, 'SIGKILL'), options.drainGraceMs ?? 2_000)
      }, options.terminateGraceMs ?? 2_000)
    }
    const abort = () => fail(cancelled())
    const consume =
      (callback?: (chunk: Buffer) => void, diagnostic = false) =>
      (input: Buffer) => {
        const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input)
        if (diagnostic)
          diagnostics = Buffer.concat([diagnostics, chunk.subarray(-16 * 1024)]).subarray(
            -16 * 1024,
          )
        if (failure !== undefined || settled) return
        try {
          callback?.(chunk)
        } catch (error) {
          fail(error)
        }
      }
    listen(child.stdout, 'data', consume(options.onStdout))
    listen(child.stderr, 'data', consume(options.onStderr, true))
    for (const stream of [child.stdin, child.stdout, child.stderr]) listen(stream, 'error', fail)
    listen(child, 'error', (error: Error) => {
      Object.assign(error, { kind: 'startup' })
      fail(error)
    })
    listen(child, 'exit', (code: number | null, exitSignal: NodeJS.Signals | null) => {
      exited = true
      clearTimeout(killTimer)
      clearTimeout(drainTimer)
      drainTimer = setTimeout(() => {
        failure ??= new ProcessExecutionError(
          'protocol',
          'Process output streams did not close after exit',
        )
        finish(code, exitSignal)
      }, options.drainGraceMs ?? 2_000)
    })
    listen(child, 'close', finish)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  return { child, completed, fail }
}
