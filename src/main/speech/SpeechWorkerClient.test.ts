import { join } from 'path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'events'
import { PassThrough, Writable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { SpeechWorkerRequestSchema } from '../../shared/speechWorker.types'
import { SpeechWorkerClient, SpeechWorkerFailure } from './SpeechWorkerClient'

const fixture = join(__dirname, '__fixtures__', 'worker-fixture.mjs')
const request = SpeechWorkerRequestSchema.parse({
  protocolVersion: 1,
  jobId: 'job-1',
  audioPath: '/tmp/source.wav',
  language: 'en',
  transcriptUnits: [{ id: '550e8400-e29b-41d4-a716-446655440001', text: 'hello', kind: 'speech' }],
  models: { alignment: 'alignment-en', diarization: 'diarization-default' },
  config: { device: 'cpu' },
})

class BrokenPipeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin: Writable
  readonly kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGTERM'))
    return true
  })

  constructor() {
    super()
    this.stdin = new Writable({
      write: (_chunk, _encoding, callback) => {
        const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
        setImmediate(() => this.emit('close', 1, null))
        callback(error)
      },
    })
  }
}

describe('SpeechWorkerClient', () => {
  it('does not mislabel a valid worker failure as malformed protocol', async () => {
    const error = await new SpeechWorkerClient(process.execPath, [fixture, 'worker-error'])
      .run(request, new AbortController().signal)
      .catch((error) => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(SpeechWorkerFailure)
    expect(error.code).toBe('alignment-model-unavailable')
    expect(error.message).toContain('model computation failed')
    expect(error.kind).not.toBe('protocol')
  })
  it('runs one correlated JSONL job, reports progress, and ignores stderr diagnostics', async () => {
    const progress = vi.fn()
    const result = await new SpeechWorkerClient(process.execPath, [fixture, 'success']).run(
      request,
      new AbortController().signal,
      progress,
    )
    expect(result.alignment?.unalignedTranscriptUnitIds).toEqual([request.transcriptUnits?.[0].id])
    expect(progress).toHaveBeenCalledWith({ stage: 'aligning', percent: 50 })
  })

  it.each(['malformed', 'wrong-job', 'duplicate'])('rejects %s worker output', async (mode) => {
    await expect(
      new SpeechWorkerClient(process.execPath, [fixture, mode]).run(
        request,
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  })

  it('accepts a long-audio result above the legacy one-mibibyte limit', async () => {
    const result = await new SpeechWorkerClient(process.execPath, [fixture, 'large-output']).run(
      request,
      new AbortController().signal,
    )

    expect(result.alignment?.unalignedTranscriptUnitIds).toHaveLength(30_000)
  })

  it('rejects without an uncaught EPIPE when the worker cannot start', async () => {
    await expect(
      new SpeechWorkerClient('/definitely/missing/redencut-speech-worker', []).run(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects through the job promise when the worker input pipe closes', async () => {
    const child = new BrokenPipeChild()
    const spawn = vi.fn(() => child)

    await expect(
      new SpeechWorkerClient('speech-worker', [], { spawn }).run(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'EPIPE' })
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('retains a bounded diagnostic tail when the worker exits without a result', async () => {
    const error = await new SpeechWorkerClient(process.execPath, [fixture, 'crash'])
      .run(request, new AbortController().signal)
      .catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('allocation failed')
    expect((error as Error).message.length).toBeLessThan(17_000)
  })

  it('terminates and reaps the worker before cancellation settles', async () => {
    const controller = new AbortController()
    const operation = new SpeechWorkerClient(process.execPath, [fixture, 'hang'], {
      terminateGraceMs: 100,
    }).run(request, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('keeps a quiet computation alive beyond the old worker deadlines', async () => {
    vi.useFakeTimers()
    try {
      const child = new BrokenPipeChild()
      child.stdin.end = vi.fn(() => child.stdin)
      const controller = new AbortController()
      const operation = new SpeechWorkerClient('worker', [], { spawn: () => child }).run(
        request,
        controller.signal,
      )
      const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(31 * 60_000)
      expect(child.kill).not.toHaveBeenCalled()
      controller.abort()
      await rejected
    } finally {
      vi.useRealTimers()
    }
  })
  it('resolves the current runtime at each job after setup or repair', async () => {
    let command = '/runtime/before/python'
    const spawn = vi.fn(() => new BrokenPipeChild())
    const client = new SpeechWorkerClient(() => command, [], {
      spawn,
      env: () => ({ PATH: command + '/bin' }),
    })
    command = '/runtime/repaired/python'
    await expect(client.run(request, new AbortController().signal)).rejects.toThrow()
    expect(spawn).toHaveBeenCalledWith(
      command,
      [],
      expect.objectContaining({ env: expect.objectContaining({ PATH: command + '/bin' }) }),
    )
  })
  it('never forwards Hugging Face credentials to offline inference', async () => {
    const child = new BrokenPipeChild()
    const spawn = vi.fn(() => child)
    await expect(
      new SpeechWorkerClient('worker', [], {
        spawn,
        env: { HF_TOKEN: 'secret', HUGGING_FACE_HUB_TOKEN: 'secret', PATH: '/runtime' },
      }).run(request, new AbortController().signal),
    ).rejects.toThrow()
    expect(spawn).toHaveBeenCalledWith(
      'worker',
      [],
      expect.objectContaining({
        env: {
          PATH: '/runtime',
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
        },
      }),
    )
  })
})

describe('speech preflight', () => {
  async function withProbe(body: string, check: (client: SpeechWorkerClient) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'speech-preflight-'))
    try {
      const command = join(directory, 'python-fixture')
      await writeFile(command, `#!${process.execPath}\n${body}`, { mode: 0o755 })
      await check(new SpeechWorkerClient(command, []))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  it('allows analysis when the resource check reports ready', async () => {
    await withProbe('console.log(JSON.stringify({status: "ready"}))', async (client) => {
      await expect(client.preflight(new AbortController().signal)).resolves.toBeUndefined()
    })
  })

  it('reports a resource failure only for an explicit unavailable result', async () => {
    await withProbe(
      'console.log(JSON.stringify({status: "unavailable", code: "alignment-resources-unavailable"}))',
      async (client) => {
        const error = await client
          .preflight(new AbortController().signal)
          .catch((error: unknown) => error)
        expect(error).toBeInstanceOf(SpeechWorkerFailure)
        expect(error).toMatchObject({ code: 'alignment-resources-unavailable' })
        expect((error as Error).message).toContain('reinstall')
      },
    )
  })

  it('preserves an unrelated process failure instead of blaming NLTK data', async () => {
    await withProbe('process.exit(1)', async (client) => {
      const error = await client
        .preflight(new AbortController().signal)
        .catch((error: unknown) => error)
      expect(error).not.toBeInstanceOf(SpeechWorkerFailure)
      expect(error).toMatchObject({ code: 1 })
    })
  })

  it.each(['not json', '{"status":"unavailable","code":"other-failure"}', ''])(
    'rejects an invalid resource-check result: %s',
    async (output) => {
      await withProbe(`console.log(${JSON.stringify(output)})`, async (client) => {
        await expect(client.preflight(new AbortController().signal)).rejects.toMatchObject({
          kind: 'protocol',
        })
      })
    },
  )

  it('preserves missing-executable failures', async () => {
    await expect(
      new SpeechWorkerClient('/definitely/missing/python', []).preflight(
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new SpeechWorkerClient(process.execPath, []).preflight(controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
