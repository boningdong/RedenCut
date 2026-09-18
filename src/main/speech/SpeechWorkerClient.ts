import { manageProcess, ProcessExecutionError } from '../processes/ManagedProcess'
import { offlineEnvironment } from './inferenceEnvironment'
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
  terminateGraceMs?: number
  maxLineBytes?: number
  env?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv)
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
  options: {
    stdio: ['pipe', 'pipe', 'pipe']
    cwd?: string
    env?: NodeJS.ProcessEnv
  },
) => SpeechWorkerChild

const DEFAULT_MAX_JSONL_MESSAGE_BYTES = 32 * 1024 * 1024

export class SpeechWorkerClient {
  private readonly options: Required<Omit<ClientOptions, 'env' | 'cwd' | 'spawn'>> &
    Pick<ClientOptions, 'env' | 'cwd'> & { spawn: SpeechWorkerSpawn }

  constructor(
    private readonly command: string | (() => string),
    private readonly args: string[],
    options: ClientOptions = {},
  ) {
    this.options = {
      terminateGraceMs: options.terminateGraceMs ?? 2_000,
      maxLineBytes: options.maxLineBytes ?? DEFAULT_MAX_JSONL_MESSAGE_BYTES,
      env: options.env,
      cwd: options.cwd,
      spawn: options.spawn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions)),
    }
  }

  async run(
    requestInput: SpeechWorkerRequest,
    signal: AbortSignal,
    onProgress?: (event: { stage: 'aligning' | 'diarizing'; percent?: number }) => void,
  ): Promise<SpeechWorkerResult> {
    const request = SpeechWorkerRequestSchema.parse(requestInput)
    signal.throwIfAborted()
    const line = `${JSON.stringify(request)}\n`
    const protocolError = (message: string) => new ProcessExecutionError('protocol', message)
    if (Buffer.byteLength(line) > this.options.maxLineBytes)
      throw protocolError('Speech worker input line exceeded maximum size')
    let buffer = Buffer.alloc(0)
    let terminal: SpeechWorkerResult | undefined
    const operation = manageProcess(
      () =>
        this.options.spawn(
          typeof this.command === 'function' ? this.command() : this.command,
          this.args,
          {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.options.cwd,
            env: offlineEnvironment(
              (typeof this.options.env === 'function' ? this.options.env() : this.options.env) ??
                process.env,
            ),
          },
        ),
      signal,
      {
        terminateGraceMs: this.options.terminateGraceMs,
        onStdout: (chunk) => {
          buffer = Buffer.concat([buffer, chunk])
          let newline: number
          while ((newline = buffer.indexOf(10)) >= 0) {
            if (newline + 1 > this.options.maxLineBytes)
              throw protocolError('Speech worker output line exceeded maximum size')
            const text = buffer.subarray(0, newline).toString('utf8')
            buffer = buffer.subarray(newline + 1)
            if (!text.trim()) continue
            let message
            try {
              message = SpeechWorkerResponseSchema.parse(JSON.parse(text))
            } catch (error) {
              throw protocolError(error instanceof Error ? error.message : String(error))
            }
            if (message.jobId !== request.jobId)
              throw protocolError('Speech worker job ID mismatch')
            if (terminal)
              throw protocolError('Speech worker emitted messages after its terminal result')
            if (message.type === 'progress')
              onProgress?.({
                stage: message.stage,
                ...(message.percent === undefined ? {} : { percent: message.percent }),
              })
            else if (message.type === 'result') terminal = message.result
            else if (message.type === 'error')
              throw new Error(`${message.code}: ${message.message}`)
          }
          if (buffer.byteLength > this.options.maxLineBytes)
            throw protocolError('Speech worker output line exceeded maximum size')
        },
      },
    )
    try {
      operation.child?.stdin.end(line)
    } catch (error) {
      operation.fail(error)
    }
    const exit = await operation.completed
    const diagnostic = exit.diagnostics ? `\nSpeech worker stderr: ${exit.diagnostics}` : ''
    if (exit.code !== 0)
      throw new ProcessExecutionError(
        'process-exit',
        `Speech worker exited with code ${exit.code}, signal ${exit.signal ?? 'none'}${diagnostic}`,
      )
    if (buffer.toString('utf8').trim())
      throw protocolError(`Speech worker ended with a partial JSON line${diagnostic}`)
    if (!terminal)
      throw protocolError(`Speech worker exited prematurely without a result${diagnostic}`)
    return terminal
  }
}
