import { expect, it } from 'vitest'
import { ProcessExecutionError } from '../processes/ManagedProcess'
import { SpeechWorkerFailureCodes } from '../../shared/speechWorker.types'
import { SpeechWorkerFailure } from './SpeechWorkerClient'
import { SpeechAnalysisError } from './SpeechAnalysisError'
import { classifySpeechFailure } from './classifySpeechFailure'

it.each([
  [
    SpeechWorkerFailureCodes.AlignmentResourcesUnavailable,
    'speech-alignment-resources',
    'speech/alignment-resources-unavailable',
  ],
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

it('uses the deepest analysis stage when no specific worker reason applies', () => {
  const error = new SpeechAnalysisError(
    'transcribing',
    new SpeechAnalysisError(
      'diarizing',
      new SpeechWorkerFailure(SpeechWorkerFailureCodes.WorkerFailed, undefined, 'private'),
    ),
  )
  expect(classifySpeechFailure(error, 'validating')).toEqual({
    code: 'speech/worker-failed',
    reason: 'speech-diarizing',
  })
})

it('keeps the resource reason regardless of the current stage', () => {
  const error = new SpeechAnalysisError(
    'transcribing',
    new SpeechWorkerFailure(
      SpeechWorkerFailureCodes.AlignmentResourcesUnavailable,
      undefined,
      'private',
    ),
  )
  expect(classifySpeechFailure(error, 'validating')).toEqual({
    code: 'speech/alignment-resources-unavailable',
    reason: 'speech-alignment-resources',
  })
})

it('continues through an unclassified process error to its cause', () => {
  const error = new ProcessExecutionError('startup', 'private')
  error.cause = new SpeechWorkerFailure(
    SpeechWorkerFailureCodes.AlignmentModelUnavailable,
    undefined,
    'private',
  )
  expect(classifySpeechFailure(error, 'transcribing')).toEqual({
    code: 'speech/alignment-model-unavailable',
    reason: 'speech-alignment-model',
  })
})

it('terminates on a cause cycle and keeps the observed stage', () => {
  const error = new SpeechAnalysisError('publishing', undefined)
  error.cause = new Error('private', { cause: error })
  expect(classifySpeechFailure(error, 'validating')).toEqual({
    code: 'speech/publishing-failed',
    reason: 'speech-publishing',
  })
})
