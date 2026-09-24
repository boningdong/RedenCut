import { expect, it } from 'vitest'
import { ProcessExecutionError } from '../processes/ManagedProcess'
import { SpeechWorkerFailure } from './SpeechWorkerClient'
import { SpeechAnalysisError } from './SpeechAnalysisError'
import { classifySpeechFailure } from './classifySpeechFailure'

it.each([
  ['alignment-segment-mismatch', 'speech-alignment-input'],
  ['alignment-timing-invalid', 'speech-alignment-input'],
  ['alignment-window-too-long', 'speech-alignment-window'],
  ['alignment-model-unavailable', 'speech-alignment-model'],
  ['alignment-inference-failed', 'speech-aligning'],
] as const)('classifies %s as %s', (code, reason) => {
  expect(
    classifySpeechFailure(
      new SpeechAnalysisError(
        'aligning',
        new SpeechWorkerFailure(code, undefined, '/private/audio'),
      ),
      'aligning',
    ).reason,
  ).toBe(reason)
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
