import { manageProcess, ProcessExecutionError } from '../processes/ManagedProcess'
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

async function normalize(
  input: SpeechPcmInput,
  output: string,
  signal: AbortSignal,
): Promise<void> {
  const operation = manageProcess(
    () =>
      spawn(
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
      ),
    signal,
  )
  const exit = await operation.completed
  if (exit.code !== 0)
    throw new ProcessExecutionError(
      'process-exit',
      `Speech audio conversion failed (${exit.code}): ${exit.diagnostics}`,
    )
}
