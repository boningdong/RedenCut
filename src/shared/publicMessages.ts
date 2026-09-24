/** Stable business reasons, independent of translation keys. No diagnostic text crosses this contract. */
export type PublicReason =
  | 'operation-failed'
  | 'runtime-unavailable'
  | 'stale-session'
  | 'cancelled'
  | 'invalid-request'
  | 'save-failed'
  | 'candidate-invalid'
  | 'job-settlement-failed'
  | 'switch-unacknowledged'
  | 'whisper-missing'
  | 'whisper-model-missing'
  | 'speech-worker-missing'
  | 'speech-models-missing'
  | 'speech-language-unsupported'
  | 'workspace-invalid'
  | 'workspace-version'
  | 'workspace-recovered'
  | 'workspace-load'
  | 'workspace-save'
  | 'speaker-name'
  | 'speaker-color'
  | 'speaker-color-used'
  | 'speaker-color-reserved'
  | 'speech-preparing-audio'
  | 'speech-transcribing'
  | 'speech-aligning'
  | 'speech-diarizing'
  | 'speech-attributing-speakers'
  | 'speech-validating'
  | 'speech-publishing'
  | 'speech-alignment-input'
  | 'speech-alignment-window'
  | 'speech-alignment-model'
  | 'speech-worker-exit'
  | 'report-save-failed'
export type SpeechFailureKind = 'startup' | 'process-exit' | 'protocol'
export interface PublicMessage {
  failureKind?: SpeechFailureKind
  reason: PublicReason
  diagnosticId?: string
}
export type TranscriptionProgress = {
  stage: 'detecting-silence' | 'starting-transcription' | 'transcribing' | 'parsing-transcript'
  percent?: number
}
export type SpeechProgress = {
  stageStartedAtMs?: number
  estimatedDurationMs?: number
  stage:
    | 'preparing-audio'
    | 'transcribing'
    | 'aligning'
    | 'diarizing'
    | 'attributing-speakers'
    | 'validating'
    | 'publishing'
  percent?: number
}
