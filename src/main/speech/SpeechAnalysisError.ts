import type { SpeechAnalysisProgress } from './SpeechAnalysisCoordinator'

export type SpeechFailureStage = SpeechAnalysisProgress['stage'] | 'preparing-audio' | 'publishing'
const messages: Record<SpeechFailureStage, string> = {
  'preparing-audio': 'Could not prepare audio for speech analysis. Re-import this track and retry.',
  transcribing:
    'Speech recognition failed. Retry; if it persists, check the local Whisper installation and model.',
  aligning: 'Speech alignment failed. Retry; if it persists, check the installed alignment models.',
  diarizing:
    'Speaker detection failed. Retry; if it persists, check the installed speaker detection model.',
  'attributing-speakers': 'Speaker attribution failed. Retry speech analysis for this track.',
  validating: 'Speech analysis returned invalid results. Retry speech analysis for this track.',
  publishing: 'Could not save the speech analysis. Check available disk space and retry.',
}

/** Fixed public messages; the underlying engine/filesystem cause stays in main diagnostics. */
export class SpeechAnalysisError extends Error {
  constructor(stage: SpeechFailureStage, cause: unknown) {
    super(messages[stage], { cause })
    this.name = 'SpeechAnalysisError'
  }
}
