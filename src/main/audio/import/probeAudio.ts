import { RuntimeValidationError } from '../../runtime/RuntimeValidator'
import { runtimeEnvironment } from '../../runtime/RuntimeEnvironment'
import { spawn } from 'child_process'
import type { EventEmitter } from 'events'
import type { Readable } from 'stream'
import type { AudioMetadata } from '../../../shared/ProjectTypes'
import { getFfprobePath } from '../../runtime/AppRuntimeLocator'

interface FFprobeStream {
  codec_type: 'audio' | 'video' | 'subtitle'
  codec_name: string
  sample_rate: string
  channels: number
  duration?: string
  bit_rate?: string
}

interface FFprobeOutput {
  streams: FFprobeStream[]
  format?: { duration?: string; bit_rate?: string }
}

interface ProbeChild extends EventEmitter {
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals | number): boolean
}

interface ProbeDependencies {
  spawn: (
    command: string,
    arguments_: string[],
    options: { stdio: ['ignore', 'pipe', 'pipe']; env: NodeJS.ProcessEnv },
  ) => ProbeChild
}

const DEFAULT_DEPENDENCIES: ProbeDependencies = {
  spawn: (command, arguments_, options) => spawn(command, arguments_, options) as ProbeChild,
}

export async function probeAudio(
  filePath: string,
  signal: AbortSignal = new AbortController().signal,
  dependencies: ProbeDependencies = DEFAULT_DEPENDENCIES,
): Promise<AudioMetadata> {
  throwIfAborted(signal)
  let child: ProbeChild
  try {
    child = dependencies.spawn(
      getFfprobePath(),
      ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'], env: runtimeEnvironment(process.env) },
    )
  } catch (error) {
    if (error instanceof RuntimeValidationError) throw error
    throw new Error(`ffprobe failed for "${filePath}": ${(error as Error).message}`, {
      cause: error,
    })
  }

  let stdout = ''
  let stderr = ''
  let firstFailure: unknown = null
  let closed = false
  let killed = false
  const killOnce = () => {
    if (killed || closed) return
    killed = true
    child.kill('SIGKILL')
  }
  const fail = (error: unknown) => {
    if (firstFailure) return
    firstFailure = error
    killOnce()
  }
  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString()
  })
  child.stdout.once('error', fail)
  child.stderr.once('error', fail)
  child.once('error', fail)
  const childClose = new Promise<number | null>((resolve) => {
    child.once('close', (code: number | null) => {
      closed = true
      resolve(code)
    })
  })
  const abort = () => fail(abortError('FFprobe aborted'))
  if (signal.aborted) abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()

  const code = await childClose
  signal.removeEventListener('abort', abort)
  if (firstFailure) {
    if (isAbortError(firstFailure)) throw firstFailure
    throw new Error(`ffprobe failed for "${filePath}": ${(firstFailure as Error).message}`, {
      cause: firstFailure,
    })
  }
  if (code !== 0) throw new Error(`ffprobe failed for "${filePath}": ${stderr.trim()}`)

  let output: FFprobeOutput
  try {
    output = JSON.parse(stdout) as FFprobeOutput
  } catch {
    throw new Error(`ffprobe returned invalid JSON for "${filePath}"`)
  }
  const stream = output.streams.find((candidate) => candidate.codec_type === 'audio')
  if (!stream) throw new Error(`No audio stream found in "${filePath}"`)
  const durationSeconds = Number.parseFloat(stream.duration || output.format?.duration || '')
  const bitRate = stream.bit_rate || output.format?.bit_rate
  return {
    durationSeconds: Number.isNaN(durationSeconds) ? 0 : durationSeconds,
    sampleRate: Number.parseInt(stream.sample_rate, 10),
    channels: stream.channels,
    codec: stream.codec_name,
    bitrateKbps: bitRate ? Math.round(Number.parseInt(bitRate, 10) / 1000) : 0,
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError('FFprobe aborted')
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError'
}
