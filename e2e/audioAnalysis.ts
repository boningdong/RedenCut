import { execFileSync } from 'node:child_process'

export function rmsWindows(samples: Float32Array, windowSize = 4800): number[] {
  if (!Number.isInteger(windowSize) || windowSize <= 0) throw new Error('INVALID_AUDIO_WINDOW')
  const result: number[] = []
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sum = 0
    for (let index = start; index < start + windowSize; index++) sum += samples[index] ** 2
    result.push(Math.sqrt(sum / windowSize))
  }
  return result
}

export function recordedRms(path: string): number[] {
  const pcm = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
    { maxBuffer: 32 * 1024 * 1024 },
  )
  const samples = new Float32Array(pcm.length / 4)
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readFloatLE(i * 4)
  return rmsWindows(samples)
}

// Compare complete recordings of the same source. Added capture silence and the
// alignment of fixed-size RMS windows must not change a gain measurement.
export function recordedLevelChangeDb(reference: number[], candidate: number[]): number {
  const energy = (windows: number[]) => windows.reduce((sum, value) => sum + value ** 2, 0)
  const original = energy(reference)
  const changed = energy(candidate)
  if (!(original > 0) || !(changed > 0) || !Number.isFinite(original + changed))
    throw new Error('LEVEL_COMPARISON_REQUIRES_AUDIBLE_RECORDINGS')
  return 10 * Math.log10(changed / original)
}
