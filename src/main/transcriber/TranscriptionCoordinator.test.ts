import { describe, expect, it, vi } from 'vitest'
import type { AudioSourceId, Transcript } from '../../shared/project.types'
import type { WorkspaceToken } from '../../shared/session.types'
import type { TranscriptionJobId } from '../../shared/transcriber.types'
import { TranscriptionCoordinator } from './TranscriptionCoordinator'

const TOKEN = 'workspace-a' as WorkspaceToken
const SOURCE = '00000000-0000-4000-8000-000000000001' as AudioSourceId

function transcript(word: string): Transcript {
  return {
    engine: 'test',
    words: [{ id: word, text: word, start: 0, end: 1, muted: false }],
    speakers: {},
  }
}

function request(jobId: string, senderId = 1) {
  return {
    jobId: jobId as TranscriptionJobId,
    senderId,
    workspaceToken: TOKEN,
    revision: 7,
    audioSourceId: SOURCE,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('TranscriptionCoordinator', () => {
  it('tags progress and results with the exact admitted job and session', async () => {
    const transcriber = {
      transcribe: vi.fn(
        async (
          _path: string,
          _options: unknown,
          _signal: AbortSignal,
          onProgress: (status: string) => void,
        ) => {
          onProgress('Transcribing… 30%')
          return transcript('hello')
        },
      ),
    }
    const coordinator = new TranscriptionCoordinator(transcriber)
    const progress = vi.fn()

    const execution = coordinator.start(
      request('job-a'),
      vi.fn(async () => '/workspace-a/media/source.wav'),
      progress,
    )

    await expect(execution.settled).resolves.toEqual({
      jobId: 'job-a',
      workspaceToken: TOKEN,
      revision: 7,
      value: transcript('hello'),
    })
    expect(progress).toHaveBeenCalledWith({
      jobId: 'job-a',
      workspaceToken: TOKEN,
      revision: 7,
      status: 'Transcribing… 30%',
    })
  })

  it('aborts the exact operation and waits for its settlement', async () => {
    const reaped = deferred<void>()
    let admittedSignal!: AbortSignal
    const transcriber = {
      transcribe: vi.fn(async (_path: string, _options: unknown, signal: AbortSignal) => {
        admittedSignal = signal
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              void reaped.promise.then(() => reject(new DOMException('cancelled', 'AbortError')))
            },
            { once: true },
          )
        })
        return transcript('unreachable')
      }),
    }
    const coordinator = new TranscriptionCoordinator(transcriber)
    const execution = coordinator.start(request('job-a'), async () => '/source.wav', vi.fn())
    await vi.waitFor(() => expect(transcriber.transcribe).toHaveBeenCalledTimes(1))

    void execution.cancel()
    expect(admittedSignal.aborted).toBe(true)
    let settled = false
    void execution.settled.catch(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    reaped.resolve()
    await expect(execution.settled).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('supersedes a sender job and does not start the successor before old settlement', async () => {
    const firstResult = deferred<Transcript>()
    const calls: AbortSignal[] = []
    const transcriber = {
      transcribe: vi.fn(async (_path: string, _options: unknown, signal: AbortSignal) => {
        calls.push(signal)
        return calls.length === 1 ? firstResult.promise : transcript('new')
      }),
    }
    const coordinator = new TranscriptionCoordinator(transcriber)
    const first = coordinator.start(request('job-a'), async () => '/source-a.wav', vi.fn())
    await vi.waitFor(() => expect(transcriber.transcribe).toHaveBeenCalledTimes(1))

    const second = coordinator.start(request('job-b'), async () => '/source-b.wav', vi.fn())
    expect(calls[0].aborted).toBe(true)
    await Promise.resolve()
    expect(transcriber.transcribe).toHaveBeenCalledTimes(1)

    firstResult.resolve(transcript('old'))
    await expect(first.settled).rejects.toMatchObject({ name: 'AbortError' })
    await expect(second.settled).resolves.toMatchObject({
      jobId: 'job-b',
      value: { words: [{ text: 'new' }] },
    })
    expect(transcriber.transcribe).toHaveBeenCalledTimes(2)
  })
})
