import type { Track } from './ProjectTypes'
import type { PlaybackMode, AudioSampleChunk } from './PlayerTypes'
import type { SessionPrecondition } from './session.types'

export interface PrepareTrackRequest extends SessionPrecondition {
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
export interface PreparedTrackReadRequest extends SessionPrecondition {
  requestId: string
  handle: string
  startFrame: number
  frameCount: number
}
export interface PreparedAudioAPI {
  prepare(request: PrepareTrackRequest): Promise<PreparedTrackDescriptor>
  read(request: PreparedTrackReadRequest): Promise<AudioSampleChunk>
  release(request: SessionPrecondition & { requestId: string }): Promise<void>
}
export const MAX_PREPARED_READ_FRAMES = 16384
