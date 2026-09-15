import { toIpcResult } from '../../ipc/ipcResult'
import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  whisperPath: vi.fn((): string | null => '/usr/bin/whisper-cli'),
  mkdtemp: vi.fn(async () => '/tmp/redencut-whisper-job'),
  readFile: vi.fn(async () => JSON.stringify({ transcription: [], result: { language: 'en' } })),
  rm: vi.fn(async (_path?: unknown, _options?: unknown): Promise<void> => {}),
  existsSync: vi.fn((path: string) => path.endsWith('ggml-base.bin')),
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('fs/promises', () => ({
  mkdtemp: mocks.mkdtemp,
  readFile: mocks.readFile,
  rm: mocks.rm,
}))
vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../../runtime/AppRuntimeLocator', () => ({
  getWhisperPath: mocks.whisperPath,
  getFfmpegPath: () => '/usr/bin/ffmpeg',
}))

import { WhisperTranscriber } from './whisper'

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  readonly kill = vi.fn(() => true)
}

async function waitForSpawnCount(count: number): Promise<void> {
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(count))
}

async function advanceToWhisper(signal: AbortSignal) {
  const silence = new FakeChild()
  const whisper = new FakeChild()
  mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
  const transcription = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
    '/source.wav',
    {},
    signal,
  )
  await waitForSpawnCount(1)
  silence.emit('close', 0)
  await waitForSpawnCount(2)
  return { silence, whisper, transcription }
}

describe('WhisperTranscriber cancellation', () => {
  beforeEach(() => {
    mocks.whisperPath.mockReturnValue('/usr/bin/whisper-cli')
    mocks.existsSync.mockImplementation((path: string) => path.endsWith('ggml-base.bin'))
    mocks.spawn.mockReset()
    mocks.mkdtemp.mockClear()
    mocks.readFile.mockClear()
    mocks.rm.mockReset()
    mocks.rm.mockResolvedValue(undefined)
    mocks.existsSync.mockClear()
  })

  it('parses fragmented and multiple progress records while draining stdout', async () => {
    const silence = new FakeChild()
    const whisper = new FakeChild()
    mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
    const progress = vi.fn()
    const operation = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
      '/source.wav',
      {},
      new AbortController().signal,
      progress,
    )
    await waitForSpawnCount(1)
    silence.emit('close', 0)
    await waitForSpawnCount(2)
    expect(whisper.stdout.listenerCount('data')).toBeGreaterThan(0)
    whisper.stderr.emit('data', Buffer.from('progress = 1'))
    whisper.stderr.emit('data', Buffer.from('2%\nprogress = 34%\nprogress = 56%\n'))
    whisper.emit('close', 0)
    await operation
    expect(
      progress.mock.calls.filter(([p]) => p.stage === 'transcribing').map(([p]) => p.percent),
    ).toEqual([12, 34, 56])
  })
  it('continues transcribing past twenty minutes until explicitly cancelled', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const { whisper, transcription } = await advanceToWhisper(abort.signal)
    const result = transcription.catch((error: unknown) => error)
    try {
      await vi.advanceTimersByTimeAsync(21 * 60_000)
      expect(whisper.kill).not.toHaveBeenCalled()
      abort.abort()
      whisper.emit('close', null)
      expect(await result).toMatchObject({ name: 'AbortError' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('abandons a stalled optional silence probe and continues recognition', async () => {
    const silence = new FakeChild()
    const whisper = new FakeChild()
    mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
    vi.useFakeTimers()
    try {
      const operation = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
        '/source.wav',
        {},
        new AbortController().signal,
      )
      await vi.advanceTimersByTimeAsync(60_000)
      expect(silence.kill).toHaveBeenCalledWith('SIGTERM')
      await vi.advanceTimersByTimeAsync(2_000)
      expect(silence.kill).toHaveBeenCalledWith('SIGKILL')
      silence.emit('close', null)
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.spawn).toHaveBeenCalledTimes(2)
      whisper.emit('close', 0)
      await operation
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains an actionable missing-engine reason on the legacy IPC error path', async () => {
    mocks.whisperPath.mockReturnValue(null)
    const engine = new WhisperTranscriber(() => '/managed/ggml-base.bin')
    expect(await engine.unavailableReason()).toEqual({ reason: 'whisper-missing' })
    const result = await toIpcResult(
      () => engine.transcribe('/private/source.wav', {}, new AbortController().signal),
      vi.fn(),
    )
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'operation-failed', reason: 'whisper-missing' },
    })
    expect(JSON.stringify(result)).not.toContain('/private')
  })

  it('rejects an already-aborted request before creating temporary state', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
        '/source.wav',
        {},
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.mkdtemp).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('kills silence detection once and waits for close before cleanup settles', async () => {
    const child = new FakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const controller = new AbortController()
    const transcription = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
      '/source.wav',
      {},
      controller.signal,
    )
    await waitForSpawnCount(1)

    controller.abort()
    controller.abort()
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(mocks.rm).not.toHaveBeenCalled()

    child.emit('close', null)
    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/redencut-whisper-job', {
      recursive: true,
      force: true,
    })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('does not treat a later speech pause as leading silence and bounds the probe window', async () => {
    const controller = new AbortController()
    const silence = new FakeChild()
    const whisper = new FakeChild()
    mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
    const transcription = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
      '/source.wav',
      {},
      controller.signal,
    )
    await waitForSpawnCount(1)

    silence.stderr.emit('data', Buffer.from('silence_start: 10.000\nsilence_end: 12.000\n'))
    expect(silence.kill).toHaveBeenCalledTimes(1)
    silence.emit('close', null)
    await waitForSpawnCount(2)

    const probeArgs = mocks.spawn.mock.calls[0][1] as string[]
    expect(probeArgs).toEqual(expect.arrayContaining(['-t', '30']))
    const whisperArgs = mocks.spawn.mock.calls[1][1] as string[]
    expect(whisperArgs).not.toContain('--offset-t')
    whisper.emit('close', 0)
    await expect(transcription).resolves.toBeDefined()
  })

  it('uses only a true leading silence end and reaps an early-decision probe', async () => {
    const controller = new AbortController()
    const silence = new FakeChild()
    const whisper = new FakeChild()
    mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
    const transcription = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
      '/source.wav',
      {},
      controller.signal,
    )
    await waitForSpawnCount(1)

    silence.stderr.emit('data', Buffer.from('silence_sta'))
    silence.stderr.emit(
      'data',
      Buffer.from('rt: 0.000\nsilence_end: 5.023 | silence_duration: 5.023\n'),
    )
    expect(silence.kill).toHaveBeenCalledTimes(1)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    silence.emit('close', null)
    await waitForSpawnCount(2)

    const whisperArgs = mocks.spawn.mock.calls[1][1] as string[]
    expect(
      whisperArgs.slice(whisperArgs.indexOf('--offset-t'), whisperArgs.indexOf('--offset-t') + 2),
    ).toEqual(['--offset-t', '5023'])
    whisper.emit('close', 0)
    await expect(transcription).resolves.toBeDefined()
  })

  it('parses a bounded split tail without a trailing newline and ignores malformed diagnostics', async () => {
    const controller = new AbortController()
    const silence = new FakeChild()
    const whisper = new FakeChild()
    mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
    const transcription = new WhisperTranscriber(() => '/managed/ggml-base.bin').transcribe(
      '/source.wav',
      {},
      controller.signal,
    )
    await waitForSpawnCount(1)

    silence.stderr.emit('data', Buffer.from(`silence_start: malformed ${'x'.repeat(16_384)}`))
    silence.stderr.emit('data', Buffer.from(' silence_start: 0.000 silence_'))
    silence.stderr.emit('data', Buffer.from('end: 2.500'))
    silence.emit('close', 0)
    await waitForSpawnCount(2)

    const whisperArgs = mocks.spawn.mock.calls[1][1] as string[]
    expect(
      whisperArgs.slice(whisperArgs.indexOf('--offset-t'), whisperArgs.indexOf('--offset-t') + 2),
    ).toEqual(['--offset-t', '2500'])
    whisper.emit('close', 0)
    await expect(transcription).resolves.toBeDefined()
  })

  it('kills whisper once and awaits close before removing the temporary directory', async () => {
    const controller = new AbortController()
    const { whisper, transcription } = await advanceToWhisper(controller.signal)

    controller.abort()
    controller.abort()
    expect(whisper.kill).toHaveBeenCalledTimes(1)
    expect(mocks.rm).not.toHaveBeenCalled()

    whisper.emit('close', null)
    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.rm).toHaveBeenCalledTimes(1)
  })

  it('aggregates a real cleanup failure with cancellation after process reap', async () => {
    const controller = new AbortController()
    const { whisper, transcription } = await advanceToWhisper(controller.signal)
    const cleanupFailure = new Error('temporary directory remained')
    mocks.rm.mockRejectedValueOnce(cleanupFailure)

    controller.abort()
    whisper.emit('close', null)

    await expect(transcription).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AggregateError &&
        error.errors.some(
          (entry) => entry instanceof DOMException && entry.name === 'AbortError',
        ) &&
        error.errors.includes(cleanupFailure),
    )
    expect(whisper.kill).toHaveBeenCalledTimes(1)
    expect(mocks.rm).toHaveBeenCalledTimes(1)
  })

  it('reports cancellation that arrives while temporary cleanup is in flight', async () => {
    const cleanup = (() => {
      let resolve!: () => void
      const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise
      })
      return { promise, resolve }
    })()
    mocks.rm.mockReturnValueOnce(cleanup.promise)
    const controller = new AbortController()
    const { whisper, transcription } = await advanceToWhisper(controller.signal)

    whisper.emit('close', 0)
    await vi.waitFor(() => expect(mocks.rm).toHaveBeenCalledTimes(1))
    controller.abort()
    cleanup.resolve()

    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' })
    expect(whisper.kill).not.toHaveBeenCalled()
  })

  it('returns verbatim evidence without fabricating smaller timestamp units', async () => {
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        transcription: [
          {
            text: ' 觉得。',
            timestamps: { from: '00:00:00,750', to: '00:00:01,180' },
            offsets: { from: 750, to: 1180 },
            tokens: [
              {
                id: 1,
                text: ' 觉得',
                p: 0.91,
                timestamps: { from: '00:00:00,750', to: '00:00:01,180' },
              },
            ],
          },
        ],
        result: { language: 'zh' },
      }),
    )
    const controller = new AbortController()
    const { whisper, transcription } = await advanceToWhisper(controller.signal)
    whisper.emit('close', 0)

    await expect(transcription).resolves.toMatchObject({
      text: '觉得。',
      detectedLanguage: 'zh',
      verbatimCapability: 'best-effort-verbatim',
      evidence: [
        {
          text: ' 觉得。',
          sourceStart: 0.75,
          sourceEnd: 1.18,
          tokens: [{ text: ' 觉得', sourceStart: 0.75, sourceEnd: 1.18, confidence: 0.91 }],
        },
      ],
      provenance: { engineId: 'whisper.cpp', modelId: 'ggml-base.bin' },
    })
  })
  it('keeps credentials out of both native speech subprocesses', async () => {
    vi.stubEnv('HF_TOKEN', 'private-token')
    vi.stubEnv('HUGGING_FACE_HUB_TOKEN', 'private-token')
    try {
      const { whisper, transcription } = await advanceToWhisper(new AbortController().signal)
      for (const call of mocks.spawn.mock.calls) {
        expect(call[2]?.env?.HF_TOKEN).toBeUndefined()
        expect(call[2]?.env?.HUGGING_FACE_HUB_TOKEN).toBeUndefined()
        expect(call[2]?.env?.HF_HUB_OFFLINE).toBe('1')
      }
      whisper.emit('close', 0)
      await transcription
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
