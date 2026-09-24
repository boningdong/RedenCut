import type { PublicReason } from '../../shared/publicMessages'
import type { SpeechFailureStage } from './SpeechAnalysisError'
import { SpeechAnalysisError } from './SpeechAnalysisError'
import { SpeechWorkerFailure } from './SpeechWorkerClient'
import { ProcessExecutionError } from '../processes/ManagedProcess'
import type { AppFailure } from '../diagnostics/DiagnosticFailure'

export function classifySpeechFailure(
  error: unknown,
  fallbackStage: SpeechFailureStage,
): Pick<AppFailure, 'code' | 'reason'> {
  let current = error
  let stage = fallbackStage
  const seen = new Set<unknown>()
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (current instanceof SpeechAnalysisError) stage = current.stage
    if (current instanceof SpeechWorkerFailure) {
      const code = current.code
      const reason: PublicReason =
        code === 'alignment-segment-mismatch' || code === 'alignment-timing-invalid'
          ? 'speech-alignment-input'
          : code === 'alignment-window-too-long'
            ? 'speech-alignment-window'
            : code === 'alignment-model-unavailable'
              ? 'speech-alignment-model'
              : (`speech-${stage}` as PublicReason)
      return { code: `speech/${code}`, reason }
    }
    if (current instanceof ProcessExecutionError) {
      if (current.kind === 'process-exit')
        return { code: 'speech/worker-exit', reason: 'speech-worker-exit' }
      if (current.kind === 'protocol')
        return { code: 'speech/worker-protocol', reason: 'speech-validating' }
    }
    current = current.cause
  }
  return { code: `speech/${stage}-failed`, reason: `speech-${stage}` as PublicReason }
}
