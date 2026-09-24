import { expect, it } from 'vitest'
import { ProcessExecutionError } from '../processes/ManagedProcess'
import { SpeechWorkerFailureCodes } from '../../shared/speechWorker.types'
import { SpeechWorkerFailure } from './SpeechWorkerClient'
import { SpeechAnalysisError } from './SpeechAnalysisError'
import { classifySpeechFailure } from './classifySpeechFailure'

it.each([
  [
    SpeechWorkerFailureCodes.AlignmentSegmentMismatch,
    'speech-alignment-input',
    'speech/alignment-segment-mismatch',
  ],
  [
    SpeechWorkerFailureCodes.AlignmentTimingInvalid,
    'speech-alignment-input',
    'speech/alignment-timing-invalid',
  ],
  [
    SpeechWorkerFailureCodes.AlignmentWindowTooLong,
    'speech-alignment-window',
    'speech/alignment-window-too-long',
  ],
  [
    SpeechWorkerFailureCodes.AlignmentModelUnavailable,
    'speech-alignment-model',
    'speech/alignment-model-unavailable',
  ],
  [
    SpeechWorkerFailureCodes.AlignmentInferenceFailed,
    'speech-aligning',
    'speech/alignment-inference-failed',
  ],
] as const)('classifies %s as %s', (code, reason, diagnosticCode) => {
  expect(
    classifySpeechFailure(
      new SpeechAnalysisError(
        'aligning',
        new SpeechWorkerFailure(code, undefined, '/private/audio'),
      ),
      'aligning',
    ),
  ).toMatchObject({ reason, code: diagnosticCode })
})

it('distinguishes a process exit and unknown validation failure', () => {
  expect(
    classifySpeechFailure(
      new SpeechAnalysisError('aligning', new ProcessExecutionError('process-exit', 'secret')),
      'aligning',
    ).reason,
  ).toBe('speech-worker-exit')
  expect(classifySpeechFailure(new Error('secret'), 'validating').reason).toBe('speech-validating')
  expect(
    classifySpeechFailure(
      new SpeechAnalysisError(
        'aligning',
        new ProcessExecutionError('protocol', '/private/malformed'),
      ),
      'aligning',
    ).reason,
  ).toBe('speech-validating')
})
