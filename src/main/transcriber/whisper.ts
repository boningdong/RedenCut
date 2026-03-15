// ─────────────────────────────────────────────────────────────────────────────
// WhisperTranscriber
//
// Implements ITranscriber using the local whisper.cpp binary.
//
// Prerequisites (user must install):
//   brew install whisper-cpp
//
//   Then download a model manually, e.g.:
//     mkdir -p ~/.cache/whisper
//     curl -L -o ~/.cache/whisper/ggml-base.bin \
//       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
//
//   All available models: https://huggingface.co/ggerganov/whisper.cpp/tree/main
//
// How it works:
//   1. Locate the whisper-cli binary via getWhisperPath()
//   2. Find an available model file in common locations
//   3. Run: whisper-cli -m <model> -f <audio> --output-json -of <tmpdir/out>
//      stderr is streamed to extract real-time progress percentages.
//   4. Parse the JSON output — use per-token timestamps when available,
//      otherwise distribute each segment's time range evenly across its words
//   5. Return a Transcript with word-level { id, text, start, end } entries
//
// CJK handling: Chinese/Japanese/Korean characters have no spaces between
// them, so grouping tokens by leading space (the English heuristic) would
// merge everything into one giant word. Instead each token is treated as its
// own unit, and tokens that contain CJK characters are further split into
// individual characters — each with its own proportional timestamp slice.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { existsSync } from 'fs'
import { getWhisperPath, getFfmpegPath } from '../audio/binaries'
import type { ITranscriber, TranscribeOptions } from '../../shared/transcriber.types'
import type { Transcript, Word } from '../../shared/project.types'

// ── Model discovery ───────────────────────────────────────────────────────────
// Checked in priority order — smaller models are faster, larger are more accurate.
const MODEL_NAMES = ['ggml-base.bin', 'ggml-small.bin', 'ggml-tiny.bin', 'ggml-medium.bin', 'ggml-large-v3.bin']

const MODEL_SEARCH_DIRS = [
  join(homedir(), '.cache', 'whisper'),
  join(homedir(), 'Library', 'Application Support', 'whisper.cpp', 'models'),
  '/opt/homebrew/share/whisper.cpp/models',
  '/usr/local/share/whisper.cpp/models',
  '/usr/share/whisper.cpp/models',
]

function findModel(): string | null {
  for (const dir of MODEL_SEARCH_DIRS) {
    for (const name of MODEL_NAMES) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

// ── Timestamp parsing ─────────────────────────────────────────────────────────
// Whisper outputs timestamps in "HH:MM:SS,mmm" format.
function parseTimestamp(ts: string): number {
  const [hms, ms] = ts.split(',')
  const [h, m, s] = hms.split(':').map(Number)
  return h * 3600 + m * 60 + s + parseInt(ms || '0') / 1000
}

// ── CJK detection and splitting ───────────────────────────────────────────────

/** Returns true if the code point is a CJK ideograph or related character. */
function isCJKCodePoint(cp: number): boolean {
  return (
    (cp >= 0x2E80 && cp <= 0x2FFF) ||  // CJK Radicals Supplement, Kangxi Radicals
    (cp >= 0x3000 && cp <= 0x303F) ||  // CJK Symbols and Punctuation
    (cp >= 0x3040 && cp <= 0x318F) ||  // Hiragana, Katakana, Bopomofo
    (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK Extension A
    (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK Unified Ideographs (core)
    (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compatibility Ideographs
    (cp >= 0xFE30 && cp <= 0xFE4F) ||  // CJK Compatibility Forms
    (cp >= 0xFF00 && cp <= 0xFFEF)     // Halfwidth and Fullwidth Forms
  )
}

/**
 * Split a token string into display units:
 *   • CJK characters → one unit each (individual character selection)
 *   • Non-CJK runs  → one unit per contiguous run (whole word for Latin)
 *
 * Leading whitespace is stripped before splitting. Examples:
 *   " Hello"   → ["Hello"]
 *   " 你好世界"  → ["你", "好", "世", "界"]
 *   " Hi你好"   → ["Hi", "你", "好"]
 */
function tokenToUnits(rawText: string): string[] {
  const text = rawText.replace(/^\s+/, '')  // strip leading whitespace
  if (!text) return []

  const units: string[] = []
  let latinRun = ''

  for (const ch of text) {  // iterates by Unicode code point (handles surrogates)
    const cp = ch.codePointAt(0) ?? 0
    if (isCJKCodePoint(cp)) {
      if (latinRun) { units.push(latinRun); latinRun = '' }
      units.push(ch)
    } else {
      latinRun += ch
    }
  }
  if (latinRun.trim()) units.push(latinRun)

  return units.filter(u => u.trim().length > 0)
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

// ── Word extraction ───────────────────────────────────────────────────────────
let _wordIdCounter = 0
function nextId(): string {
  return `w${++_wordIdCounter}`
}

/**
 * Extracts word-level entries from a single whisper segment.
 *
 * Token-level path (preferred):
 *   Each token is split into CJK characters + Latin runs. Every resulting
 *   unit gets its own Word with proportionally sliced timestamps.
 *
 * Fallback (no token timestamps):
 *   Split the segment text: CJK chars become individual words; Latin words
 *   are split on whitespace. All distributed evenly over the segment time.
 */
function extractWords(segment: WhisperSegment): Word[] {
  const segStart = parseTimestamp(segment.timestamps.from)
  const segEnd   = parseTimestamp(segment.timestamps.to)

  // ── Token-level path ─────────────────────────────────────────────────────
  const tokens = segment.tokens?.filter(
    (t) => !t.text.startsWith('[') && t.text.trim().length > 0,
  )

  if (tokens && tokens.length > 0 && tokens[0].timestamps) {
    const words: Word[] = []

    for (const token of tokens) {
      const tStart = token.timestamps?.from
        ? parseTimestamp(token.timestamps.from)
        : segStart
      const tEnd = token.timestamps?.to
        ? parseTimestamp(token.timestamps.to)
        : segEnd

      const units = tokenToUnits(token.text)
      if (units.length === 0) continue

      const unitDur = (tEnd - tStart) / units.length
      units.forEach((unit, i) => {
        words.push({
          id: nextId(),
          text: unit,
          start: tStart + i * unitDur,
          end: tStart + (i + 1) * unitDur,
          confidence: token.p,
          muted: false,
        })
      })
    }

    return words
  }

  // ── Fallback: no token timestamps — distribute evenly ────────────────────
  // Build units: CJK characters individually, Latin words split on space.
  const allUnits: string[] = []
  for (const ch of segment.text.trim()) {
    const cp = ch.codePointAt(0) ?? 0
    if (isCJKCodePoint(cp)) {
      if (ch.trim()) allUnits.push(ch)
    } else if (ch === ' ' || ch === '\t') {
      // space: don't add as a unit, just a boundary
    } else {
      // Accumulate Latin into the last unit or start a new one
      const last = allUnits[allUnits.length - 1]
      if (last && !isCJKCodePoint(last.codePointAt(0) ?? 0)) {
        allUnits[allUnits.length - 1] = last + ch
      } else {
        allUnits.push(ch)
      }
    }
  }

  const filtered = allUnits.filter(u => u.trim())
  if (filtered.length === 0) return []

  const duration = segEnd - segStart
  const sliceDur = duration / filtered.length

  return filtered.map((text, i) => ({
    id: nextId(),
    text,
    start: segStart + i * sliceDur,
    end: segStart + (i + 1) * sliceDur,
    muted: false,
  }))
}

// ── Leading silence detection ─────────────────────────────────────────────────
/**
 * Detects how many milliseconds of silence precede the first audible speech.
 *
 * Runs FFmpeg's `silencedetect` filter and reads the first `silence_end` line
 * from stderr, e.g. "silence_end: 5.023 | silence_duration: 5.023".
 *
 * Returns 0 if the audio starts immediately (no leading silence) or if
 * detection fails for any reason — making this always safe to call.
 *
 * The result is passed to whisper as `--offset-t <ms>` so that whisper's
 * internal timestamp coordinate system starts at the real speech onset rather
 * than at position 0 of the file.
 */
async function detectLeadingSilence(audioFilePath: string): Promise<number> {
  return new Promise((resolve) => {
    let ffmpegPath: string
    try { ffmpegPath = getFfmpegPath() }
    catch { return resolve(0) }   // ffmpeg not available — not fatal here

    const proc = spawn(ffmpegPath, [
      '-i', audioFilePath,
      '-af', 'silencedetect=n=-40dB:d=0.1',   // silence < -40 dB for >= 0.1 s
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', () => {
      // FFmpeg prints: "[silencedetect] silence_end: 5.023 | silence_duration: 5.023"
      // We want only the FIRST silence_end — that's the end of the leading silence.
      const match = stderr.match(/silence_end:\s*([\d.]+)/)
      if (match) {
        const endSeconds = parseFloat(match[1])
        resolve(Math.round(endSeconds * 1000))   // convert to integer ms
      } else {
        resolve(0)   // audio starts immediately — no offset needed
      }
    })

    proc.on('error', () => resolve(0))   // non-fatal: proceed without offset
  })
}

// ── WhisperTranscriber ────────────────────────────────────────────────────────
export class WhisperTranscriber implements ITranscriber {
  readonly name = 'Whisper.cpp (local)'

  async isAvailable(): Promise<boolean> {
    return (await this.unavailableReason()) === null
  }

  async unavailableReason(): Promise<string | null> {
    const binary = getWhisperPath()
    if (!binary) {
      return (
        'whisper-cli not found.\n' +
        'Install with: brew install whisper-cpp\n' +
        'Then restart the app.'
      )
    }
    const model = findModel()
    if (!model) {
      return (
        'No Whisper model found.\n\n' +
        'Run this in Terminal to download the base model (~142 MB):\n\n' +
        '  mkdir -p ~/.cache/whisper\n' +
        '  curl -L -o ~/.cache/whisper/ggml-base.bin \\\n' +
        '    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin\n\n' +
        'Other model sizes (larger = more accurate, slower):\n' +
        '  tiny (~75 MB)  base (~142 MB)  small (~466 MB)  medium (~1.5 GB)  large-v3 (~2.9 GB)\n\n' +
        'Browse all models: https://huggingface.co/ggerganov/whisper.cpp/tree/main\n' +
        '(Replace "ggml-base.bin" in the curl command with any model filename from that page.)\n\n' +
        'Then restart the app.'
      )
    }
    return null
  }

  async transcribe(
    audioFilePath: string,
    options: TranscribeOptions = {},
    onProgress?: (status: string) => void,
  ): Promise<Transcript> {
    const binary = getWhisperPath()
    if (!binary) throw new Error(await this.unavailableReason() ?? 'whisper-cli not found')

    const model = options.model && existsSync(options.model)
      ? options.model
      : findModel()
    if (!model) throw new Error(await this.unavailableReason() ?? 'No Whisper model found')

    // Write output to a temp directory so we don't litter the audio folder
    const tmpDir = await mkdtemp(join(tmpdir(), 'podcut-whisper-'))
    const outputPrefix = join(tmpDir, 'out')

    try {
      onProgress?.('Detecting silence…')

      // Detect leading silence so whisper's timestamps are correctly anchored.
      // whisper always starts its first timestamp at 0 (the chunk window start),
      // so without this offset the first words appear to start at 0 s even when
      // there is several seconds of silence before any speech.
      const leadingSilenceMs = await detectLeadingSilence(audioFilePath)

      onProgress?.('Starting transcription…')

      const args = [
        '-m', model,
        '-f', audioFilePath,
        '--output-json',
        '-of', outputPrefix,
        '--print-progress',   // whisper-cli prints progress lines to stderr
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
        args.push('-l', 'auto')   // auto-detect language
      }

      // ── Spawn with streaming stderr for real-time progress ──────────────
      // execFileAsync collects output only at the end; spawn lets us read
      // stderr line-by-line so we can forward percentage updates to the UI.
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(binary, args)
        let lastPct = -1

        proc.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          // whisper.cpp emits lines like:
          //   "whisper_print_progress_callback: progress = 20%"
          const match = text.match(/progress\s*=\s*(\d+)\s*%/i)
          if (match) {
            const pct = parseInt(match[1], 10)
            if (pct !== lastPct) {
              lastPct = pct
              onProgress?.(`Transcribing… ${pct}%`)
            }
          }
        })

        // Kill the process after 20 minutes to avoid hanging indefinitely
        const timeout = setTimeout(() => {
          proc.kill()
          reject(new Error('Transcription timed out after 20 minutes'))
        }, 20 * 60 * 1000)

        proc.on('close', (code) => {
          clearTimeout(timeout)
          if (code === 0 || code === null) resolve()
          else reject(new Error(`whisper-cli exited with code ${code}`))
        })

        proc.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })

      onProgress?.('Parsing transcript…')

      const jsonPath = `${outputPrefix}.json`
      const raw = await readFile(jsonPath, 'utf-8')
      const parsed: WhisperJson = JSON.parse(raw)

      // Reset word ID counter for this transcription
      _wordIdCounter = 0

      const words: Word[] = parsed.transcription.flatMap(extractWords)
      const language = parsed.result?.language ?? options.language ?? 'unknown'

      return {
        engine: 'whisper.cpp',
        model: model.split('/').pop() ?? model,
        words,
        speakers: {},
        ...({ language } as object),
      } as Transcript

    } finally {
      // Clean up temp directory
      await rm(tmpDir, { recursive: true, force: true })
    }
  }
}

export const whisperTranscriber = new WhisperTranscriber()
