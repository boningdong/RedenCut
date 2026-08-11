// ─────────────────────────────────────────────────────────────────────────────
// Audio Importer
//
// Uses ffprobe to extract metadata from an audio file without decoding it.
// This is fast (~50ms for a 1GB file) because ffprobe only reads the file
// header and container metadata.
//
// Why not use the Web Audio API decodeAudioData() in the renderer?
//   Because decoding a 1GB WAV file into Float32Array in the renderer would
//   allocate 3–4 GB of memory and likely crash the tab. Always probe in main.
// ─────────────────────────────────────────────────────────────────────────────

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AudioMetadata } from '../../shared/project.types'
import { getFfprobePath } from './binaries'

const execFileAsync = promisify(execFile)

// ── FFprobe JSON output shape (partial — only what we need) ───────────────────
interface FFprobeStream {
  codec_type: 'audio' | 'video' | 'subtitle'
  codec_name: string
  sample_rate: string // ffprobe returns numbers as strings
  channels: number
  duration: string
  bit_rate: string
}

interface FFprobeOutput {
  streams: FFprobeStream[]
}

// ─────────────────────────────────────────────────────────────────────────────
// probeAudio
//
// Runs `ffprobe -v quiet -print_format json -show_streams <file>` and parses
// the JSON output to extract the audio stream metadata.
// ─────────────────────────────────────────────────────────────────────────────
export async function probeAudio(filePath: string): Promise<AudioMetadata> {
  let stdout: string

  try {
    const result = await execFileAsync(getFfprobePath(), [
      '-v',
      'quiet', // suppress banner/warnings
      '-print_format',
      'json', // output as JSON
      '-show_streams', // include stream info (codec, sample rate, etc.)
      filePath,
    ])
    stdout = result.stdout
  } catch (err) {
    throw new Error(`ffprobe failed for "${filePath}": ${(err as Error).message}`, { cause: err })
  }

  let output: FFprobeOutput
  try {
    output = JSON.parse(stdout)
  } catch {
    throw new Error(`ffprobe returned invalid JSON for "${filePath}"`)
  }

  // Find the first audio stream
  const audioStream = output.streams.find((s) => s.codec_type === 'audio')
  if (!audioStream) {
    throw new Error(`No audio stream found in "${filePath}"`)
  }

  const durationSeconds = parseFloat(audioStream.duration)
  const bitrateKbps = audioStream.bit_rate
    ? Math.round(parseInt(audioStream.bit_rate, 10) / 1000)
    : 0

  return {
    durationSeconds: isNaN(durationSeconds) ? 0 : durationSeconds,
    sampleRate: parseInt(audioStream.sample_rate, 10),
    channels: audioStream.channels,
    codec: audioStream.codec_name,
    bitrateKbps,
  }
}
