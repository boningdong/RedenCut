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
