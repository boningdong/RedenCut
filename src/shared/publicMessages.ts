/** Stable business reasons, independent of translation keys. No diagnostic text crosses this contract. */
export type PublicReason =
  | 'operation-failed'
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
export interface PublicMessage {
  reason: PublicReason
}
export type TranscriptionProgress = {
  stage: 'detecting-silence' | 'starting-transcription' | 'transcribing' | 'parsing-transcript'
  percent?: number
}
export type SpeechProgress = {
  stage:
    'transcribing' | 'aligning' | 'diarizing' | 'attributing-speakers' | 'validating' | 'publishing'
  percent?: number
}
