import type { SpeechProgress } from '../../shared/publicMessages'

export interface MeasuredStageProfile {
  stage: SpeechProgress['stage']
  /** Exact model, configuration, device and cold/warm condition measured together. */
  configuration: string
  minimumAudioDurationSeconds: number
  maximumAudioDurationSeconds: number
  fixedOverheadMs: number
  processingMsPerAudioSecond: number
  uncertaintyMultiplier: number
}

/** Estimates describe measured performance; they never authorize terminating inference. */
export class SpeechStagePolicy {
  // The probe examines only the first 30 seconds as an optional optimization.
  // Exhausting this budget falls back to normal transcription; it never times out inference.
  static readonly leadingSilenceProbeBudgetMs = 60_000

  constructor(private readonly profiles: readonly MeasuredStageProfile[] = []) {}

  forStage(
    stage: SpeechProgress['stage'],
    audioDurationSeconds: number,
    configuration: string,
  ): { estimatedDurationMs?: number } {
    const profile = this.profiles.find(
      (candidate) =>
        candidate.stage === stage &&
        candidate.configuration === configuration &&
        [
          candidate.minimumAudioDurationSeconds,
          candidate.maximumAudioDurationSeconds,
          candidate.fixedOverheadMs,
          candidate.processingMsPerAudioSecond,
          candidate.uncertaintyMultiplier,
          audioDurationSeconds,
        ].every(Number.isFinite) &&
        candidate.minimumAudioDurationSeconds >= 0 &&
        candidate.fixedOverheadMs >= 0 &&
        candidate.processingMsPerAudioSecond >= 0 &&
        candidate.uncertaintyMultiplier >= 1 &&
        audioDurationSeconds >= candidate.minimumAudioDurationSeconds &&
        audioDurationSeconds <= candidate.maximumAudioDurationSeconds,
    )
    if (!profile) return {}
    const estimatedDurationMs = Math.ceil(
      (profile.fixedOverheadMs + audioDurationSeconds * profile.processingMsPerAudioSecond) *
        profile.uncertaintyMultiplier,
    )
    return Number.isFinite(estimatedDurationMs) && estimatedDurationMs > 0
      ? { estimatedDurationMs }
      : {}
  }

  createProgressTracker(
    audioDurationSeconds: number,
    configuration: string | (() => string),
    now: () => number = Date.now,
  ): (progress: SpeechProgress) => SpeechProgress {
    let stage: SpeechProgress['stage'] | undefined
    let stageStartedAtMs = 0
    return (progress) => {
      if (progress.stage !== stage) {
        stage = progress.stage
        stageStartedAtMs = now()
      }
      return {
        ...progress,
        stageStartedAtMs,
        ...this.forStage(
          stage,
          audioDurationSeconds,
          typeof configuration === 'function' ? configuration() : configuration,
        ),
      }
    }
  }
}
