import { z } from 'zod'
import type { AudioSourceId } from '../source.types'
export const MAX_CROSSFADE_DURATION_MS = 1000

export const CrossfadeSettingsSchema = z
  .object({
    enabled: z.boolean(),
    durationMs: z.number().finite().min(1).max(MAX_CROSSFADE_DURATION_MS),
    curve: z.enum(['linear', 'equal-power']),
  })
  .strict()
export type CrossfadeSettings = z.infer<typeof CrossfadeSettingsSchema>
export type CrossfadeCurve = CrossfadeSettings['curve']
export const DEFAULT_CROSSFADE_SETTINGS: Readonly<CrossfadeSettings> = Object.freeze({
  enabled: true,
  durationMs: 30,
  curve: 'equal-power',
})
export interface SourceSpan {
  audioSourceId: AudioSourceId
  sourceStartFrame: number
  frameCount: number
}
interface CrossfadeOwner {
  clipId: string
  redactionIds: string[]
}
export interface ResolvedCrossfade {
  owner: CrossfadeOwner
  left: SourceSpan
  right: SourceSpan
  outputStartFrame: number
  frameCount: number
  curve: CrossfadeCurve
  leftTimelineStartFrame: number
  rightTimelineStartFrame: number
}
export type CrossfadeResolution =
  | {
      owner: CrossfadeOwner
      status: 'active'
      transition: ResolvedCrossfade
      limitedBy?: 'short-content' | 'neighbor-transition'
    }
  | {
      owner: CrossfadeOwner
      status: 'inactive'
      reason: 'disabled' | 'no-join' | 'insufficient-content' | 'protected-track-content'
    }
