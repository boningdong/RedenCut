import { spawn } from 'child_process'
import type { EventEmitter } from 'events'
import type { Readable, Writable } from 'stream'
import {
  SpeechWorkerRequestSchema,
  SpeechWorkerResponseSchema,
  type SpeechWorkerRequest,
  type SpeechWorkerResult,
} from '../../shared/speechWorker.types'

interface ClientOptions {
  overallTimeoutMs?: number
  noProgressTimeoutMs?: number
  terminateGraceMs?: number
  maxLineBytes?: number
  env?: NodeJS.ProcessEnv
  cwd?: string
  spawn?: SpeechWorkerSpawn
}

interface SpeechWorkerChild extends EventEmitter {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals | number): boolean
}

type SpeechWorkerSpawn = (
  command: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; cwd?: string; env?: NodeJS.ProcessEnv },
) => SpeechWorkerChild

const DEFAULT_MAX_JSONL_MESSAGE_BYTES = 32 * 1024 * 1024

export class SpeechWorkerClient {
  private readonly options: Required<Omit<ClientOptions, 'env' | 'cwd' | 'spawn'>> &
    Pick<ClientOptions, 'env' | 'cwd'> & { spawn: SpeechWorkerSpawn }

  constructor(
    private readonly command: string,
    private readonly args: string[],
    options: ClientOptions = {},
  ) {
    this.options = {
      overallTimeoutMs: options.overallTimeoutMs ?? 30 * 60_000,
      noProgressTimeoutMs: options.noProgressTimeoutMs ?? 5 * 60_000,
      terminateGraceMs: options.terminateGraceMs ?? 2_000,
      maxLineBytes: options.maxLineBytes ?? DEFAULT_MAX_JSONL_MESSAGE_BYTES,
      env: options.env,
      cwd: options.cwd,
      spawn: options.spawn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions)),
    }
  }

  run(
    requestInput: SpeechWorkerRequest,
    signal: AbortSignal,
    onProgress?: (event: { stage: 'aligning' | 'diarizing'; percent?: number }) => void,
  ): Promise<SpeechWorkerResult> {
    const request = SpeechWorkerRequestSchema.parse(requestInput)
    if (signal.aborted) return Promise.reject(abortError())
    const child = this.options.spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.cwd,
      env: this.options.env,
    })
    child.stderr.resume()
    return this.observe(child, request, signal, onProgress)
  }

  private observe(
    child: SpeechWorkerChild,
    request: SpeechWorkerRequest,
    signal: AbortSignal,
    onProgress?: (event: { stage: 'aligning' | 'diarizing'; percent?: number }) => void,
  ): Promise<SpeechWorkerResult> {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      let terminal: SpeechWorkerResult | undefined
      let failure: unknown
      let terminating = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      let noProgressTimer: ReturnType<typeof setTimeout>
      const overallTimer = setTimeout(
        () => fail(new Error('Speech worker overall timeout')),
        this.options.overallTimeoutMs,
      )
      const armNoProgress = () => {
        clearTimeout(noProgressTimer)
        noProgressTimer = setTimeout(
          () => fail(new Error('Speech worker no-progress timeout')),
          this.options.noProgressTimeoutMs,
        )
      }
      const terminate = () => {
        if (terminating) return
        terminating = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.options.terminateGraceMs)
      }
      const fail = (error: unknown) => {
        failure ??= error
        terminate()
      }
      const onAbort = () => fail(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      armNoProgress()

      child.stdout.on('data', (chunk: Buffer) => {
        if (failure) return
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.byteLength > this.options.maxLineBytes) {
          fail(new Error('Speech worker output line exceeded maximum size'))
          return
        }
        let newline: number
        while ((newline = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0, newline).toString('utf8')
          buffer = buffer.subarray(newline + 1)
          if (!line.trim()) continue
          try {
            const message = SpeechWorkerResponseSchema.parse(JSON.parse(line))
            if (message.jobId !== request.jobId) throw new Error('Speech worker job ID mismatch')
            armNoProgress()
            if (message.type === 'progress')
              onProgress?.({
                stage: message.stage,
                ...(message.percent === undefined ? {} : { percent: message.percent }),
              })
            else if (message.type === 'result') {
              if (terminal) throw new Error('Speech worker emitted duplicate terminal messages')
              terminal = message.result
            } else if (message.type === 'error') {
              if (terminal) throw new Error('Speech worker emitted duplicate terminal messages')
              throw new Error(`${message.code}: ${message.message}`)
            }
          } catch (error) {
            fail(error)
            return
          }
        }
      })
      child.stdin.once('error', fail)
      child.stdout.once('error', fail)
      child.stderr.once('error', fail)
      child.once('error', fail)
      child.once('close', (code) => {
        clearTimeout(overallTimer)
        clearTimeout(noProgressTimer)
        if (killTimer) clearTimeout(killTimer)
        signal.removeEventListener('abort', onAbort)
        if (failure) reject(failure)
        else if (buffer.toString('utf8').trim())
          reject(new Error('Speech worker ended with a partial JSON line'))
        else if (!terminal) reject(new Error(`Speech worker exited prematurely with code ${code}`))
        else if (code !== 0) reject(new Error(`Speech worker exited with code ${code}`))
        else resolve(terminal)
      })
      try {
        const line = `${JSON.stringify(request)}\n`
        if (Buffer.byteLength(line) > this.options.maxLineBytes) {
          fail(new Error('Speech worker input line exceeded maximum size'))
          return
        }
        child.stdin.end(line)
      } catch (error) {
        fail(error)
      }
    })
  }
}

function abortError(): DOMException {
  return new DOMException('Speech analysis cancelled', 'AbortError')
}
