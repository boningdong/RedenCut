import type { DevelopmentEnvironment } from './developmentEnvironment.types'
import type { ResourceCapability } from './resources.types'

/** Whisper uses the native CLI; Python libraries belong to alignment and diarization. */
export function modelRuntimeReady(
  environment: DevelopmentEnvironment | undefined,
  capability: ResourceCapability,
): boolean {
  if (!environment) return true
  return capability === 'transcription'
    ? environment.ffmpeg && environment.whisper
    : environment.ready
}
