// ─────────────────────────────────────────────────────────────────────────────
// Peak Generator
//
// Generates waveform "peaks" — a downsampled representation of audio amplitude
// over time. This is what wavesurfer.js displays as the waveform.
//
// Why not let wavesurfer decode the audio itself?
//   wavesurfer's default behaviour calls AudioContext.decodeAudioData() on the
//   entire file. A 1-hour 48kHz stereo WAV = ~1.65 GB on disk, but ~3.3 GB in
//   memory as Float32Array. This crashes the renderer for any real episode.
//
//   Instead: we decode here in the main process via FFmpeg (which streams the
//   file, never loading it all into memory), downsample to ~1 peak per 256
//   samples, and cache the result. wavesurfer loads the tiny peaks JSON file
//   (~200 KB for a 1-hour episode) and never touches the raw audio.
//
// Cache strategy:
//   Peaks are cached as <audio-basename>.peaks.json in the same directory.
//   On subsequent opens, the cache is loaded instantly (no FFmpeg run).
//   The cache is invalidated if the audio file's size changes (cheap check).
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { PeakData } from '../../shared/project.types'
import { getFfmpegPath } from './binaries'

// Number of audio samples represented by each peak value.
// 256 samples @ 48kHz = ~5.3ms per peak = ~190 peaks/second.
// A 1-hour episode = ~684,000 peaks per channel ≈ 2.7 MB as Float32 (reasonable).
const SAMPLES_PER_PEAK = 256

// ─────────────────────────────────────────────────────────────────────────────
// generatePeaks
//
// Reads audio via FFmpeg (raw PCM f32le output), downsamples to peaks,
// and caches the result.
//
// Progress: calls onProgress(0–1) periodically so the UI can show a spinner.
// ─────────────────────────────────────────────────────────────────────────────
export async function generatePeaks(
  audioFilePath: string,
  durationSeconds: number,
  onProgress?: (progress: number) => void,
): Promise<PeakData> {
  // ── Check cache ───────────────────────────────────────────────────────────
  const cacheFilePath = getCacheFilePath(audioFilePath)
  const cached = loadCache(audioFilePath, cacheFilePath)
  if (cached) {
    onProgress?.(1)
    return cached
  }

  // ── Decode audio via FFmpeg → raw PCM ─────────────────────────────────────
  // We pipe FFmpeg's raw PCM output directly into Node as a Buffer stream.
  // This avoids ever having the full decoded audio in memory simultaneously —
  // FFmpeg streams it chunk by chunk.
  //
  // FFmpeg args:
  //   -i <file>      : input file (any format)
  //   -f f32le       : output format: raw 32-bit float, little-endian
  //   -ac 1          : mix down to mono (peaks don't need stereo)
  //   -ar 44100      : resample to 44.1 kHz for consistent peak density
  //   pipe:1         : write to stdout instead of a file

  const peaks: number[] = []
  let chunkBuffer = Buffer.alloc(0)
  let totalSamplesProcessed = 0

  // Estimated total samples (used for progress calculation)
  const estimatedTotalSamples = Math.ceil(durationSeconds * 44100)

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(
      getFfmpegPath(),
      ['-i', audioFilePath, '-f', 'f32le', '-ac', '1', '-ar', '44100', 'pipe:1'],
      {
        // We only care about stdout (PCM). Suppress stderr (ffmpeg banner/progress).
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      // Accumulate chunk bytes
      chunkBuffer = Buffer.concat([chunkBuffer, chunk])

      // Process complete float32 values (4 bytes each)
      const bytesPerSample = 4
      const samplesInBuffer = Math.floor(chunkBuffer.length / bytesPerSample)
      const bytesToProcess = samplesInBuffer * bytesPerSample

      if (samplesInBuffer < SAMPLES_PER_PEAK) return // wait for more data

      const samples = new Float32Array(chunkBuffer.buffer, chunkBuffer.byteOffset, samplesInBuffer)

      // Downsample: take max absolute value per SAMPLES_PER_PEAK window
      let i = 0
      while (i + SAMPLES_PER_PEAK <= samples.length) {
        let max = 0
        for (let j = i; j < i + SAMPLES_PER_PEAK; j++) {
          const abs = Math.abs(samples[j])
          if (abs > max) max = abs
        }
        peaks.push(max)
        i += SAMPLES_PER_PEAK
      }

      totalSamplesProcessed += samplesInBuffer
      // Keep leftover bytes that don't form a complete window
      chunkBuffer = chunkBuffer.slice(bytesToProcess)

      // Emit progress
      if (onProgress && estimatedTotalSamples > 0) {
        onProgress(Math.min(totalSamplesProcessed / estimatedTotalSamples, 0.99))
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code} while generating peaks`))
    })

    ffmpeg.on('error', reject)
  })

  const peakData: PeakData = {
    data: [peaks],
    length: peaks.length,
    durationSeconds,
  }

  // ── Write cache ───────────────────────────────────────────────────────────
  saveCache(audioFilePath, cacheFilePath, peakData)

  onProgress?.(1)
  return peakData
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
interface CacheFile {
  audioFileSize: number // used as cheap invalidation key
  peaks: PeakData
}

function getCacheFilePath(audioFilePath: string): string {
  const { dir, name } = path.parse(audioFilePath)
  return path.join(dir, `${name}.peaks.json`)
}

function loadCache(audioFilePath: string, cacheFilePath: string): PeakData | null {
  try {
    if (!fs.existsSync(cacheFilePath)) return null
    const audioSize = fs.statSync(audioFilePath).size
    const cache: CacheFile = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'))
    if (cache.audioFileSize !== audioSize) return null // file changed → invalidate
    return cache.peaks
  } catch {
    return null
  }
}

function saveCache(audioFilePath: string, cacheFilePath: string, peaks: PeakData): void {
  try {
    const audioSize = fs.statSync(audioFilePath).size
    const cache: CacheFile = { audioFileSize: audioSize, peaks }
    fs.writeFileSync(cacheFilePath, JSON.stringify(cache))
  } catch (err) {
    // Cache write failure is non-fatal — peaks were generated, just not cached
    console.warn('Failed to write peaks cache:', err)
  }
}
