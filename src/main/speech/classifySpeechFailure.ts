import type { PublicReason } from '../../shared/publicMessages'
import type { SpeechFailureStage } from './SpeechAnalysisError'
import { SpeechAnalysisError } from './SpeechAnalysisError'
import { SpeechWorkerFailure } from './SpeechWorkerClient'
import { ProcessExecutionError } from '../processes/ManagedProcess'
import type { AppFailure } from '../diagnostics/DiagnosticFailure'
import {
  SpeechWorkerFailureCodes,
  type SpeechWorkerFailureCode,
} from '../../shared/speechWorker.types'
import { AppDiagnosticCodes } from '../../shared/diagnostics.types'

type FailureClassification = Pick<AppFailure, 'code' | 'reason'>

const workerFailureReasons: Partial<Record<SpeechWorkerFailureCode, PublicReason>> = {
  [SpeechWorkerFailureCodes.AlignmentResourcesUnavailable]: 'speech-alignment-resources',
  [SpeechWorkerFailureCodes.AlignmentSegmentMismatch]: 'speech-alignment-input',
  [SpeechWorkerFailureCodes.AlignmentTimingInvalid]: 'speech-alignment-input',
  [SpeechWorkerFailureCodes.AlignmentWindowTooLong]: 'speech-alignment-window',
  [SpeechWorkerFailureCodes.AlignmentModelUnavailable]: 'speech-alignment-model',
}

function classifyKnownFailure(
  error: Error,
  stage: SpeechFailureStage,
): FailureClassification | undefined {
  if (error instanceof SpeechWorkerFailure) {
    return {
      code: `speech/${error.code}`,
      reason: workerFailureReasons[error.code] ?? (`speech-${stage}` as PublicReason),
    }
  }
  if (error instanceof ProcessExecutionError) {
    switch (error.kind) {
      case 'process-exit':
        return { code: AppDiagnosticCodes.SpeechWorkerExit, reason: 'speech-worker-exit' }
      case 'protocol':
        return { code: AppDiagnosticCodes.SpeechWorkerProtocol, reason: 'speech-validating' }
    }
  }
  return undefined
}

export function classifySpeechFailure(
  error: unknown,
  fallbackStage: SpeechFailureStage,
): FailureClassification {
  let current = error
  let stage = fallbackStage
  const seen = new Set<unknown>()
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    if (current instanceof SpeechAnalysisError) stage = current.stage
    const classification = classifyKnownFailure(current, stage)
    if (classification) return classification
    current = current.cause
  }
  return { code: `speech/${stage}-failed`, reason: `speech-${stage}` as PublicReason }
}
