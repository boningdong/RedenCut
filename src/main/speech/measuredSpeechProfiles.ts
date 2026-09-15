import { basename } from 'path'
import type { MeasuredStageProfile } from './SpeechStagePolicy'

const diarizationRevision = '3533c8cf8e369892e6b79ff1bf80f7b0286a54ee'
const configuration = `darwin/arm64/Apple M4/cores10/cpu/intraop4-interop10/pyannote4.0.7/torch2.8.0/${diarizationRevision}`

// Native measurements and limits: docs/superpowers/calibration/2026-09-14-speech-diarization.md.
// Use the slowest observed duration ratio with an explicit conservative allowance.
export const measuredSpeechProfiles: readonly MeasuredStageProfile[] = [
  {
    stage: 'diarizing',
    configuration,
    minimumAudioDurationSeconds: 300,
    maximumAudioDurationSeconds: 900,
    fixedOverheadMs: 0,
    processingMsPerAudioSecond: 216239 / 300,
    uncertaintyMultiplier: 1.5,
  },
]

interface ExecutionContext {
  platform: string
  architecture: string
  cpuModels: readonly string[]
  device: string
  modelPaths?: Readonly<Record<string, string>>
  environment: NodeJS.ProcessEnv
}

/** Only managed, pinned dependencies on the measured host/configuration qualify. */
export function measuredSpeechConfiguration(context: ExecutionContext): string {
  if (
    context.platform !== 'darwin' ||
    context.architecture !== 'arm64' ||
    // The measured M4 has 10 cores (4 performance + 6 efficiency); pinned torch
    // defaults to 4 intraop / 10 interop threads here, not on every M4 variant.
    context.cpuModels.length !== 10 ||
    context.cpuModels.some((model) => model !== 'Apple M4') ||
    context.device !== 'cpu' ||
    basename(context.modelPaths?.['diarization-default'] ?? '') !== diarizationRevision
  )
    return 'uncalibrated'
  for (const [key, value] of Object.entries(context.environment)) {
    if (value === undefined) continue
    if (key === 'OMP_NUM_THREADS' || key === 'MKL_NUM_THREADS') {
      if (value !== '4') return 'uncalibrated'
    } else if (
      /^(OMP_|MKL_|OPENBLAS_|BLIS_|VECLIB_|NUMEXPR_|GOTO_|TBB_|BLAS_|ACCELERATE_)/.test(key) ||
      key === 'TORCH_NUM_THREADS' ||
      key === 'TORCH_NUM_INTEROP_THREADS'
    ) {
      return 'uncalibrated'
    }
  }
  return configuration
}
