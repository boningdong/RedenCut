import { expect, it, vi } from 'vitest'
import { recordTerminalFailure } from './DiagnosticFailure'

it('records one safe failure with an ID while retaining private causes in main', () => {
  const write = vi.fn().mockResolvedValue(undefined)
  const failure = recordTerminalFailure(
    new Error('/private/audio.wav', { cause: new Error('token=secret') }),
    {
      operationId: 'job-1',
      stage: 'aligning',
      classify: () => ({ code: 'speech/alignment-inference-failed', reason: 'speech-aligning' }),
    },
    { write },
  )
  expect(failure).toMatchObject({ reason: 'speech-aligning', diagnosticId: expect.any(String) })
  expect(write).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(write.mock.calls)).not.toContain('/private/')
  expect(JSON.stringify(write.mock.calls)).not.toContain('token=')
})

it('does not record cancellation or invalid requests', () => {
  const write = vi.fn()
  expect(
    recordTerminalFailure(
      new DOMException('aborted', 'AbortError'),
      { operationId: 'job-1' },
      { write },
    ),
  ).toEqual({ reason: 'cancelled' })
  expect(
    recordTerminalFailure(new Error('bad'), { operationId: 'job-2', validation: true }, { write }),
  ).toEqual({ reason: 'invalid-request' })
  expect(write).not.toHaveBeenCalled()
})
