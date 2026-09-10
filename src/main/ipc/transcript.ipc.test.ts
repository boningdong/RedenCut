import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptionResult } from '../../shared/transcriber.types'
import type { WorkspaceToken } from '../../shared/session.types'
import { SessionJobRegistry } from '../project/SessionJobRegistry'

type IpcHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  transcribe: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler),
  },
}))

vi.mock('../transcriber/whisper', () => ({
  whisperTranscriber: {
    unavailableReason: vi.fn(async () => null),
    transcribe: mocks.transcribe,
  },
}))

import { registerTranscriptIpc } from './transcript.ipc'
import type { WorkspaceController } from '../project/WorkspaceController'

const TOKEN = 'workspace-a' as WorkspaceToken
const SOURCE = '00000000-0000-4000-8000-000000000001'

function transcript(text: string): TranscriptionResult {
  return {
    text,
    detectedLanguage: 'en',
    verbatimCapability: 'best-effort-verbatim',
    evidence: [{ text, tokens: [{ text, sourceStart: 0, sourceEnd: 1 }] }],
    provenance: {
      engineId: 'test',
      engineVersion: '1',
      modelId: 'test-model',
      configHash: 'a'.repeat(64),
      artifactSchemaVersion: 1,
      createdAt: '2026-09-09T00:00:00.000Z',
    },
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

function sender(id = 1) {
  const destroyed = new Set<() => void>()
  return {
    id,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.add(listener)
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'destroyed') destroyed.delete(listener)
    }),
    destroy: () => {
      const listeners = [...destroyed]
      destroyed.clear()
      listeners.forEach((listener) => listener())
    },
    destroyedListenerCount: () => destroyed.size,
  }
}

function controllerStub() {
  let current = true
  const resolveOriginal = vi.fn(async () => '/workspace-a/media/source.wav')
  return {
    setCurrent(value: boolean) {
      current = value
    },
    assertCurrent: vi.fn((_expected?: unknown) => {
      if (!current) throw new Error('Stale workspace token')
    }),
    captureOriginalResolver: vi.fn(() => resolveOriginal),
    resolveOriginal,
  }
}

function request(jobId: string) {
  return {
    jobId,
    workspaceToken: TOKEN,
    revision: 3,
    audioSourceId: SOURCE,
  }
}

describe('transcript IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.transcribe.mockReset()
  })

  it('captures the admitted session resolver before asynchronous process work', async () => {
    const controller = controllerStub()
    mocks.transcribe.mockResolvedValue(transcript('hello'))
    registerTranscriptIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
    )

    const result = mocks.handlers.get('transcript:generate')!(
      { sender: sender() },
      request('job-a'),
    )
    await Promise.resolve()

    expect(controller.captureOriginalResolver).toHaveBeenCalledWith(request('job-a'))
    expect(controller.resolveOriginal).toHaveBeenCalledWith(SOURCE)
    await expect(result).resolves.toMatchObject({
      ok: true,
      value: { jobId: 'job-a', workspaceToken: TOKEN, revision: 3 },
    })
  })

  it('acknowledges overlapping explicit cancellation only after exact settlement', async () => {
    const controller = controllerStub()
    const cleanup = deferred<void>()
    let signal!: AbortSignal
    mocks.transcribe.mockImplementation(async (_path, _options, admittedSignal: AbortSignal) => {
      signal = admittedSignal
      await new Promise<void>((_resolve, reject) => {
        admittedSignal.addEventListener(
          'abort',
          () => {
            void cleanup.promise.then(() => reject(new DOMException('cancelled', 'AbortError')))
          },
          { once: true },
        )
      })
      return transcript('unreachable')
    })
    const jobs = new SessionJobRegistry()
    registerTranscriptIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    const event = { sender: sender() }
    const generating = mocks.handlers.get('transcript:generate')!(event, request('job-a'))
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1))

    const first = mocks.handlers.get('transcript:cancel')!(event, request('job-a'))
    const second = mocks.handlers.get('transcript:cancel')!(event, request('job-a'))
    await vi.waitFor(() => expect(signal.aborted).toBe(true))
    let acknowledged = false
    void Promise.resolve(first).then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)

    cleanup.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, value: 'cancelled' },
      { ok: true, value: 'cancelled' },
    ])
    await expect(generating).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    await expect(
      mocks.handlers.get('transcript:cancel')!(event, request('job-a')),
    ).resolves.toEqual({ ok: true, value: 'not-found' })
  })

  it('authorizes cancellation by the admitted starting revision after current revision advances', async () => {
    const controller = controllerStub()
    let signal!: AbortSignal
    mocks.transcribe.mockImplementation(async (_path, _options, admittedSignal: AbortSignal) => {
      signal = admittedSignal
      return new Promise<TranscriptionResult>((_resolve, reject) => {
        admittedSignal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        )
      })
    })
    const jobs = new SessionJobRegistry()
    registerTranscriptIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    const event = { sender: sender() }
    const generating = mocks.handlers.get('transcript:generate')!(event, request('job-a'))
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1))
    controller.assertCurrent.mockImplementation((expected: unknown) => {
      if ((expected as { revision: number }).revision !== 4)
        throw new Error('Stale workspace revision')
    })

    await expect(
      mocks.handlers.get('transcript:cancel')!(event, { ...request('job-a'), revision: 4 }),
    ).resolves.toEqual({ ok: true, value: 'not-found' })
    expect(signal.aborted).toBe(false)
    await expect(
      mocks.handlers.get('transcript:cancel')!(event, request('job-a')),
    ).resolves.toEqual({ ok: true, value: 'cancelled' })
    expect(signal.aborted).toBe(true)
    await generating
  })

  it.each(['success', 'failure'] as const)(
    'removes the per-job destroyed listener after %s settlement',
    async (outcome) => {
      const controller = controllerStub()
      if (outcome === 'success') mocks.transcribe.mockResolvedValue(transcript('done'))
      else mocks.transcribe.mockRejectedValue(new Error('failed'))
      registerTranscriptIpc(
        controller as unknown as WorkspaceController,
        new SessionJobRegistry(),
        vi.fn(),
      )
      const ownedSender = sender()

      await mocks.handlers.get('transcript:generate')!({ sender: ownedSender }, request('job-a'))

      expect(ownedSender.destroyedListenerCount()).toBe(0)
      expect(ownedSender.removeListener).toHaveBeenCalledTimes(1)
    },
  )

  it('sender destruction and session closing abort their exact admitted operation', async () => {
    const controller = controllerStub()
    const signals: AbortSignal[] = []
    mocks.transcribe.mockImplementation(
      async (_path, _options, signal: AbortSignal) =>
        new Promise<TranscriptionResult>((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          )
        }),
    )
    const jobs = new SessionJobRegistry()
    registerTranscriptIpc(controller as unknown as WorkspaceController, jobs, vi.fn())
    const firstSender = sender(1)
    const secondSender = sender(2)
    const first = mocks.handlers.get('transcript:generate')!(
      { sender: firstSender },
      request('job-a'),
    )
    const second = mocks.handlers.get('transcript:generate')!(
      { sender: secondSender },
      request('job-b'),
    )
    await vi.waitFor(() => expect(signals).toHaveLength(2))

    firstSender.destroy()
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(signals[1].aborted).toBe(false)
    jobs.beginClosing(TOKEN)
    await jobs.cancelAndSettleToken(TOKEN)
    expect(signals[1].aborted).toBe(true)
    await Promise.all([first, second])
  })

  it('awaits an old same-sender operation before starting its replacement', async () => {
    const controller = controllerStub()
    const old = deferred<TranscriptionResult>()
    const signals: AbortSignal[] = []
    mocks.transcribe.mockImplementation(async (_path, _options, signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? old.promise : transcript('new')
    })
    registerTranscriptIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
    )
    const event = { sender: sender() }
    const first = mocks.handlers.get('transcript:generate')!(event, request('job-a'))
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1))
    const second = mocks.handlers.get('transcript:generate')!(event, request('job-b'))

    expect(signals[0].aborted).toBe(true)
    expect(mocks.transcribe).toHaveBeenCalledTimes(1)
    old.resolve(transcript('old'))
    await expect(first).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    await expect(second).resolves.toMatchObject({
      ok: true,
      value: { jobId: 'job-b', value: { words: [{ text: 'new' }] } },
    })
  })

  it('drops progress and result after the session envelope becomes stale', async () => {
    const controller = controllerStub()
    const pending = deferred<TranscriptionResult>()
    let progress!: (status: string) => void
    mocks.transcribe.mockImplementation(async (_path, _options, _signal, report) => {
      progress = report
      return pending.promise
    })
    registerTranscriptIpc(
      controller as unknown as WorkspaceController,
      new SessionJobRegistry(),
      vi.fn(),
    )
    const ownedSender = sender()
    const generating = mocks.handlers.get('transcript:generate')!(
      { sender: ownedSender },
      request('job-a'),
    )
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1))

    controller.setCurrent(false)
    progress('Transcribing… 90%')
    pending.resolve(transcript('old'))

    expect(ownedSender.send).not.toHaveBeenCalled()
    await expect(generating).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale-session' },
    })
  })
})
