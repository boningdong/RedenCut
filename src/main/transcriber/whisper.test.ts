import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(async () => '/tmp/podcut-whisper-job'),
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
vi.mock('../audio/binaries', () => ({
  getWhisperPath: () => '/usr/bin/whisper-cli',
  getFfmpegPath: () => '/usr/bin/ffmpeg',
}))

import { WhisperTranscriber } from './whisper'

class FakeChild extends EventEmitter {
  readonly stderr = new EventEmitter()
  readonly kill = vi.fn(() => true)
}

async function waitForSpawnCount(count: number): Promise<void> {
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(count))
}

async function advanceToWhisper(signal: AbortSignal) {
  const silence = new FakeChild()
  const whisper = new FakeChild()
  mocks.spawn.mockReturnValueOnce(silence).mockReturnValueOnce(whisper)
  const transcription = new WhisperTranscriber().transcribe('/source.wav', {}, signal)
  await waitForSpawnCount(1)
  silence.emit('close', 0)
  await waitForSpawnCount(2)
  return { silence, whisper, transcription }
}

describe('WhisperTranscriber cancellation', () => {
  beforeEach(() => {
    mocks.spawn.mockReset()
    mocks.mkdtemp.mockClear()
    mocks.readFile.mockClear()
    mocks.rm.mockReset()
    mocks.rm.mockResolvedValue(undefined)
    mocks.existsSync.mockClear()
  })

  it('rejects an already-aborted request before creating temporary state', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      new WhisperTranscriber().transcribe('/source.wav', {}, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.mkdtemp).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('kills silence detection once and waits for close before cleanup settles', async () => {
    const child = new FakeChild()
    mocks.spawn.mockReturnValueOnce(child)
    const controller = new AbortController()
    const transcription = new WhisperTranscriber().transcribe('/source.wav', {}, controller.signal)
    await waitForSpawnCount(1)

    controller.abort()
    controller.abort()
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(mocks.rm).not.toHaveBeenCalled()

    child.emit('close', null)
    await expect(transcription).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.rm).toHaveBeenCalledWith('/tmp/podcut-whisper-job', {
      recursive: true,
      force: true,
    })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
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
})
