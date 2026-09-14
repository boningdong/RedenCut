import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getFfmpegPath } from '../runtime/AppRuntimeLocator'

export interface SpeechPcmInput {
  path: string
  sampleRate: number
  channels: number
}

/** Both engines consume the same decoded source, independent of the imported container codec. */
export async function withSpeechAudio<T>(
  input: SpeechPcmInput,
  signal: AbortSignal,
  analyze: (wavPath: string) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  const root = await mkdtemp(join(tmpdir(), 'redencut-speech-audio-'))
  try {
    const output = join(root, 'analysis.wav')
    await normalize(input, output, signal)
    signal.throwIfAborted()
    return await analyze(output)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function normalize(input: SpeechPcmInput, output: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(
      getFfmpegPath(),
      [
        '-v',
        'error',
        '-nostdin',
        '-f',
        'f32le',
        '-ar',
        String(input.sampleRate),
        '-ac',
        String(input.channels),
        '-i',
        input.path,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        output,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let diagnostic = ''
    let failure: unknown
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const terminate = (error: unknown) => {
      if (failure) return
      failure = error
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
    }
    const abort = () =>
      terminate(new DOMException('Speech audio preparation cancelled', 'AbortError'))
    const timeout = setTimeout(
      () => terminate(new Error('Speech audio preparation timed out')),
      5 * 60_000,
    )
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096)
    })
    child.once('error', (error) => {
      failure = error
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (code !== 0)
        reject(new Error(`Speech audio conversion failed (${code}): ${diagnostic}`))
      else resolve()
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
