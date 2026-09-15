import type { AudioSourceId } from './source.types'
import type { PublicMessage } from './publicMessages'

export type SpeechBatchScope = { kind: 'all' } | { kind: 'track'; trackId: string }
export type SpeechBatchPhase = 'text' | 'speakers'
export interface SpeechBatchProgress {
  phase: SpeechBatchPhase
  sourceIndex: number
  sourceCount: number
  audioSourceId: AudioSourceId
  displayName: string
}
interface SpeechBatchFailure {
  audioSourceId: AudioSourceId
  displayName: string
  phase: SpeechBatchPhase
  error: PublicMessage
}
export interface SpeechBatchSummary {
  sourceCount: number
  completedCount: number
  reusedCount: number
  failures: SpeechBatchFailure[]
  cancelled: boolean
}
