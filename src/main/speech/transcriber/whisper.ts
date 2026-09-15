import { SpeechStagePolicy } from '../SpeechStagePolicy'
import { offlineEnvironment } from '../inferenceEnvironment'
import { TranscriberUnavailableError } from './TranscriberUnavailableError'
import type { PublicMessage, TranscriptionProgress } from '../../../shared/publicMessages'
import { spawn } from 'child_process'
import { manageProcess, ProcessExecutionError } from '../../processes/ManagedProcess'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { StringDecoder } from 'string_decoder'
import { existsSync } from 'fs'
import { createHash } from 'crypto'
import { getWhisperPath, getFfmpegPath } from '../../runtime/AppRuntimeLocator'
import type {
  ITranscriber,
  TranscribeOptions,
  TranscriptionResult,
} from '../../../shared/transcriber.types'

// ── Timestamp parsing ─────────────────────────────────────────────────────────
// Whisper outputs timestamps in "HH:MM:SS,mmm" format.
function parseTimestamp(ts: string): number {
  const [hms, ms] = ts.split(',')
  const [h, m, s] = hms.split(':').map(Number)
  return h * 3600 + m * 60 + s + parseInt(ms || '0') / 1000
}

// ── Whisper JSON types ────────────────────────────────────────────────────────
interface WhisperToken {
  id: number
  text: string
  p?: number
  timestamps?: { from: string; to: string }
  offsets?: { from: number; to: number }
}

interface WhisperSegment {
  timestamps: { from: string; to: string }
  offsets: { from: number; to: number }
  text: string
  tokens?: WhisperToken[]
}

interface WhisperJson {
  transcription: WhisperSegment[]
  result?: { language?: string }
}

// ── Leading silence detection ─────────────────────────────────────────────────
/**
 * Detects how many milliseconds of silence precede the first audible speech.
 *
 * Probes only the first 30 seconds and returns a silence end only when its
 * matching first silence interval begins at the start of the file.
 *
 * Returns 0 if the audio starts immediately (no leading silence) or if
 * detection fails for any reason — making this always safe to call.
 *
 * The result is passed to whisper as `--offset-t <ms>` so that whisper's
 * internal timestamp coordinate system starts at the real speech onset rather
 * than at position 0 of the file.
 */
async function detectLeadingSilence(audioFilePath: string, signal: AbortSignal): Promise<number> {
  throwIfAborted(signal)
  let ffmpegPath: string
  try {
    ffmpegPath = getFfmpegPath()
  } catch {
    return 0
  }

  const launch = () =>
    spawn(
      ffmpegPath,
      ['-i', audioFilePath, '-t', '30', '-af', 'silencedetect=n=-40dB:d=0.1', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'], env: offlineEnvironment(process.env) },
    )
  const decoder = new StringDecoder('utf8')
  let tail = ''
  let leadingInterval = false
  let decision: number | undefined
  const inspect = (line: string) => {
    const markers = line.matchAll(/silence_(start|end):\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)
    for (const marker of markers) {
      const seconds = Number.parseFloat(marker[2])
      if (!Number.isFinite(seconds)) continue
      if (marker[1] === 'start') {
        if (leadingInterval) continue
        if (Math.abs(seconds) <= 0.05) leadingInterval = true
        else decision = 0
      } else {
        decision = leadingInterval ? Math.max(0, Math.round(seconds * 1000)) : 0
      }
      if (decision !== undefined) {
        return
      }
    }
  }
  const consume = (text: string, flush = false) => {
    const lines = `${tail}${text}`.split(/\r?\n/)
    tail = flush ? '' : (lines.pop() ?? '').slice(-4096)
    for (const line of lines) {
      inspect(line)
      if (decision !== undefined) return
    }
    if (flush && tail) inspect(tail)
  }

  const operation = manageProcess(launch, signal, {
    onStderr: (chunk) => {
      if (decision === undefined) consume(decoder.write(chunk))
      if (decision !== undefined) operation.fail(new Error('Leading silence decision complete'))
    },
  })
  // This optimization only reads 30 seconds. A stalled probe must not block recognition.
  const timeout = setTimeout(
    () => operation.fail(new Error('Leading silence probe exceeded its execution budget')),
    SpeechStagePolicy.leadingSilenceProbeBudgetMs,
  )
  try {
    const exit = await operation.completed
    if (decision === undefined) consume(decoder.end(), true)
    return exit.code === 0 ? (decision ?? 0) : 0
  } catch {
    throwIfAborted(signal)
    return decision ?? 0
  } finally {
    clearTimeout(timeout)
  }
}

// ── WhisperTranscriber ────────────────────────────────────────────────────────
export class WhisperTranscriber implements ITranscriber {
  readonly name = 'Whisper.cpp (local)'

  constructor(private modelResolver: () => string | null = () => null) {}

  setModelResolver(resolver: () => string | null): void {
    this.modelResolver = resolver
  }

  private findModel(): string | null {
    const path = this.modelResolver()
    return path && existsSync(path) ? path : null
  }

  async isAvailable(): Promise<boolean> {
    return (await this.unavailableReason()) === null
  }

  async unavailableReason(): Promise<PublicMessage | null> {
    if (!getWhisperPath()) return { reason: 'whisper-missing' }
    if (!this.findModel()) return { reason: 'whisper-model-missing' }
    return null
  }

  async transcribe(
    audioFilePath: string,
    options: TranscribeOptions = {},
    signal: AbortSignal,
    onProgress?: (status: TranscriptionProgress) => void,
  ): Promise<TranscriptionResult> {
    throwIfAborted(signal)
    const binary = getWhisperPath()
    if (!binary) throw new TranscriberUnavailableError('whisper-missing')

    const model = options.model
      ? existsSync(options.model)
        ? options.model
        : null
      : this.findModel()
    if (!model) throw new TranscriberUnavailableError('whisper-model-missing')

    // Write output to a temp directory so we don't litter the audio folder
    const tmpDir = await mkdtemp(join(tmpdir(), 'redencut-whisper-'))
    const outputPrefix = join(tmpDir, 'out')

    let result: TranscriptionResult | undefined
    let operationError: unknown
    try {
      throwIfAborted(signal)
      onProgress?.({ stage: 'detecting-silence' })

      // Detect leading silence so whisper's timestamps are correctly anchored.
      // whisper always starts its first timestamp at 0 (the chunk window start),
      // so without this offset the first words appear to start at 0 s even when
      // there is several seconds of silence before any speech.
      const leadingSilenceMs = await detectLeadingSilence(audioFilePath, signal)

      throwIfAborted(signal)
      onProgress?.({ stage: 'starting-transcription' })

      const args = [
        '-m',
        model,
        '-f',
        audioFilePath,
        '--output-json',
        '-of',
        outputPrefix,
        '--print-progress', // whisper-cli prints progress lines to stderr
      ]

      if (leadingSilenceMs > 0) {
        // Tell whisper to begin processing at this offset. It adds the value to
        // every timestamp it emits, so the first word lands at the correct
        // absolute position in the audio track.
        args.push('--offset-t', String(leadingSilenceMs))
      }

      if (options.language) {
        args.push('-l', options.language)
      } else {
        args.push('-l', 'auto') // auto-detect language
      }

      // ── Spawn with streaming stderr for real-time progress ──────────────
      // execFileAsync collects output only at the end; spawn lets us read
      // stderr line-by-line so we can forward percentage updates to the UI.
      let lastPct = -1
      let progressTail = ''
      const operation = manageProcess(
        () => spawn(binary, args, { env: offlineEnvironment(process.env) }),
        signal,
        {
          onStderr: (chunk) => {
            const text = progressTail + chunk.toString('utf8')
            let consumed = 0
            for (const match of text.matchAll(/progress\s*=\s*(\d+)\s*%/gi)) {
              consumed = match.index + match[0].length
              const pct = Number(match[1])
              if (pct >= 0 && pct <= 100 && pct > lastPct) {
                lastPct = pct
                onProgress?.({ stage: 'transcribing', percent: pct })
              }
            }
            progressTail = text.slice(consumed).slice(-4096)
          },
        },
      )
      const exit = await operation.completed
      if (exit.code !== 0)
        throw new ProcessExecutionError(
          'process-exit',
          `whisper-cli exited with code ${exit.code}, signal ${exit.signal ?? 'none'}: ${exit.diagnostics}`,
        )

      throwIfAborted(signal)
      onProgress?.({ stage: 'parsing-transcript' })

      const jsonPath = `${outputPrefix}.json`
      const raw = await readFile(jsonPath, 'utf-8')
      const parsed: WhisperJson = JSON.parse(raw)

      const language = parsed.result?.language ?? options.language ?? 'unknown'

      result = {
        text: parsed.transcription
          .map((segment) => segment.text)
          .join(' ')
          .trim(),
        detectedLanguage: language,
        verbatimCapability: 'best-effort-verbatim',
        evidence: parsed.transcription.map((segment) => ({
          text: segment.text,
          sourceStart: parseTimestamp(segment.timestamps.from),
          sourceEnd: parseTimestamp(segment.timestamps.to),
          tokens: segment.tokens?.map((token) => ({
            text: token.text,
            sourceStart: token.timestamps?.from ? parseTimestamp(token.timestamps.from) : undefined,
            sourceEnd: token.timestamps?.to ? parseTimestamp(token.timestamps.to) : undefined,
            confidence: token.p,
          })),
        })),
        provenance: {
          engineId: 'whisper.cpp',
          engineVersion: 'system',
          modelId: model.split('/').pop() ?? model,
          configHash: createHash('sha256')
            .update(JSON.stringify({ language: options.language ?? 'auto' }))
            .digest('hex'),
          artifactSchemaVersion: 1,
          createdAt: new Date().toISOString(),
        },
      }
    } catch (error) {
      operationError = error
    }

    let cleanupError: unknown
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch (error) {
      cleanupError = error
    }

    if (operationError === undefined && signal.aborted) operationError = abortError()
    if (operationError !== undefined && cleanupError !== undefined)
      throw new AggregateError(
        [operationError, cleanupError],
        'Transcription and temporary-directory cleanup failed',
      )
    if (operationError !== undefined) throw operationError
    if (cleanupError !== undefined) throw cleanupError
    return result!
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function abortError(): DOMException {
  return new DOMException('Transcription cancelled', 'AbortError')
}

export const whisperTranscriber = new WhisperTranscriber()
