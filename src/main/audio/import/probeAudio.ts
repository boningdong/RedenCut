import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AudioMetadata } from '../../../shared/project.types'
import { getFfprobePath } from '../binaries'

const execFileAsync = promisify(execFile)

interface FFprobeStream {
  codec_type: 'audio' | 'video' | 'subtitle'
  codec_name: string
  sample_rate: string
  channels: number
  duration: string
  bit_rate?: string
}

interface FFprobeOutput {
  streams: FFprobeStream[]
}

export async function probeAudio(filePath: string): Promise<AudioMetadata> {
  let stdout: string
  try {
    stdout = (
      await execFileAsync(getFfprobePath(), [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        filePath,
      ])
    ).stdout
  } catch (error) {
    throw new Error(`ffprobe failed for "${filePath}": ${(error as Error).message}`, {
      cause: error,
    })
  }

  let output: FFprobeOutput
  try {
    output = JSON.parse(stdout) as FFprobeOutput
  } catch {
    throw new Error(`ffprobe returned invalid JSON for "${filePath}"`)
  }
  const stream = output.streams.find((candidate) => candidate.codec_type === 'audio')
  if (!stream) throw new Error(`No audio stream found in "${filePath}"`)
  const durationSeconds = Number.parseFloat(stream.duration)
  return {
    durationSeconds: Number.isNaN(durationSeconds) ? 0 : durationSeconds,
    sampleRate: Number.parseInt(stream.sample_rate, 10),
    channels: stream.channels,
    codec: stream.codec_name,
    bitrateKbps: stream.bit_rate ? Math.round(Number.parseInt(stream.bit_rate, 10) / 1000) : 0,
  }
}
