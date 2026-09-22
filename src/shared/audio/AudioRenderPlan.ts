import type { NormalizeParams } from '../TrackEffects'
import type { SourceSpan, CrossfadeResolution } from './CrossfadeTypes'
import type { GainEnvelope } from './GainEnvelope'
import type { TimelineTimeMap } from './TimelineTimeMap'
export interface AudioContribution {
  clipId: string
  source: SourceSpan
  outputStartFrame: number
  gain: number
  envelope: GainEnvelope
}
export interface TrackRenderPlan {
  trackId: string
  gainDb?: number
  normalize?: NormalizeParams
  volume: number
  contributions: AudioContribution[]
}
export interface AudioRenderPlan {
  sampleRate: 48000
  durationFrames: number
  tracks: TrackRenderPlan[]
  timeMap: TimelineTimeMap
  resolutions: CrossfadeResolution[]
}
