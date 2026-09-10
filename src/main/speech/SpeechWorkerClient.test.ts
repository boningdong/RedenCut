import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { SpeechWorkerRequestSchema } from '../../shared/speechWorker.types'
import { SpeechWorkerClient } from './SpeechWorkerClient'

const fixture = join(__dirname, '__fixtures__', 'worker-fixture.mjs')
const request = SpeechWorkerRequestSchema.parse({
  protocolVersion: 1, jobId: 'job-1', audioPath: '/tmp/source.wav', language: 'en',
  transcriptUnits: [{ id: '550e8400-e29b-41d4-a716-446655440001', text: 'hello', kind: 'speech' }],
  models: { alignment: 'alignment-en', diarization: 'diarization-default' }, config: { device: 'cpu' },
})

describe('SpeechWorkerClient', () => {
  it('runs one correlated JSONL job, reports progress, and ignores stderr diagnostics', async () => {
    const progress = vi.fn()
    const result = await new SpeechWorkerClient(process.execPath, [fixture, 'success']).run(
      request, new AbortController().signal, progress,
    )
    expect(result.alignment.unalignedTranscriptUnitIds).toEqual([request.transcriptUnits[0].id])
    expect(progress).toHaveBeenCalledWith({ stage: 'aligning', percent: 50 })
  })

  it.each(['malformed', 'wrong-job', 'duplicate'])('rejects %s worker output', async (mode) => {
    await expect(new SpeechWorkerClient(process.execPath, [fixture, mode]).run(
      request, new AbortController().signal,
    )).rejects.toThrow()
  })

  it('terminates and reaps the worker before cancellation settles', async () => {
    const controller = new AbortController()
    const operation = new SpeechWorkerClient(process.execPath, [fixture, 'hang'], {
      overallTimeoutMs: 5_000, noProgressTimeoutMs: 5_000, terminateGraceMs: 100,
    }).run(request, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })
})
