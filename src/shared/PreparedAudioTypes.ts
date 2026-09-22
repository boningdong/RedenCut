import type { Track } from './ProjectTypes'
import type { PlaybackMode, AudioSampleChunk } from './PlayerTypes'
import type { SessionPrecondition } from './session.types'

interface PrepareTrackRequest extends SessionPrecondition {
  requestId: string
  tracks: Track[]
  trackId: string
  mode: PlaybackMode
}
export interface PreparedTrackDescriptor {
  handle: string
  channels: number
  frameCount: number
}
interface PreparedTrackReadRequest extends SessionPrecondition {
  requestId: string
  handle: string
  startFrame: number
  frameCount: number
}
export interface PreparedWaveformData {
  buckets: { min: number; max: number }[]
  peak: number
}
export interface PreparedAudioAPI {
  waveform(
    request: SessionPrecondition & {
      requestId: string
      handle: string
      startFrame: number
      endFrame: number
      targetBuckets: number
    },
  ): Promise<PreparedWaveformData>
  prepare(request: PrepareTrackRequest): Promise<PreparedTrackDescriptor>
  read(request: PreparedTrackReadRequest): Promise<AudioSampleChunk>
  release(request: SessionPrecondition & { requestId: string }): Promise<void>
}
export const MAX_PREPARED_READ_FRAMES = 16384

export const MAX_PREPARED_WAVEFORM_BUCKETS = 4096
