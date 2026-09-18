import type * as Os from 'os'
import { EventEmitter } from 'events'
import type { IpcResult } from '../../shared/ipc.types'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkspaceController } from '../project/WorkspaceController'
import { SessionJobRegistry } from '../project/SessionJobRegistry'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<IpcResult<unknown>>>(),
  run: vi.fn(),
  unavailableReason: vi.fn(),
  existsSync: vi.fn(),
  prepare: vi.fn(),
  platform: vi.fn(() => 'unknown'),
  architecture: vi.fn(() => 'unknown'),
  cpus: vi.fn(() => [{ model: 'unknown' }]),
}))
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof Os>()),
  platform: mocks.platform,
  arch: mocks.architecture,
  cpus: mocks.cpus,
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => Promise<IpcResult<unknown>>) =>
      mocks.handlers.set(name, fn),
  },
}))
vi.mock('../speech/SpeechAnalysisCoordinator', () => ({
  SpeechAnalysisCoordinator: class {
    run = mocks.run
  },
}))
vi.mock('../speech/prepareSpeechAudio', () => ({ withSpeechAudio: mocks.prepare }))
vi.mock('../speech/transcriber/whisper', () => ({
  whisperTranscriber: { unavailableReason: mocks.unavailableReason, setModelResolver: vi.fn() },
}))
vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../runtime/AppRuntimeLocator', () => ({
  AppRuntimeLocator: class {
    getFfmpegPath() {
      return '/managed/bin/ffmpeg'
    }
    getSpeechPythonPath() {
      return '/managed/python'
    }
  },
}))
import { registerSpeechAnalysisIpc } from './speechAnalysis.ipc'

beforeEach(() => {
  mocks.platform.mockReturnValue('unknown')
  mocks.architecture.mockReturnValue('unknown')
  mocks.cpus.mockReturnValue([{ model: 'unknown' }])
  mocks.handlers.clear()
  mocks.unavailableReason.mockResolvedValue(null)
  mocks.existsSync.mockReturnValue(true)
  mocks.run.mockReset()
  mocks.prepare.mockReset()
})

afterEach(() => vi.unstubAllEnvs())

function setup(services?: Parameters<typeof registerSpeechAnalysisIpc>[3]) {
  const sources = [
    { id: 'first', fingerprint: { sha256: 'wav-original' } },
    { id: 'second', fingerprint: { sha256: 'm4a-original' }, metadata: { durationSeconds: 300 } },
  ]
  const resolvePcm = vi.fn(async (id: string) => ({
    path: `/cache/${id}/audio.f32le`,
    sampleRate: 48000,
    channels: 2,
  }))
  const controller = {
    workspace: { project: { audioSources: sources, speakerLabelOverrides: [] } },
    assertCurrent: vi.fn(),
    assertWorkspaceCurrent: vi.fn(),
    captureBackgroundSpeechPcmResolver: () => resolvePcm,
    describe: vi.fn(async () => ({ workspaceToken: 'workspace', revision: 3 })),
    captureOriginalResolver: () => async (id: string) => `/media/${id}.m4a`,
    captureSpeechPcmResolver: () => resolvePcm,
    commitSpeechAnalysis: vi.fn(async () => ({ revision: 3 })),
  }
  mocks.prepare.mockImplementation(async (_pcm, _signal, analyze) =>
    analyze('/temporary/analysis.wav'),
  )
  mocks.run.mockResolvedValue({ artifact: true })
  const diagnostics = vi.fn()
  registerSpeechAnalysisIpc(
    controller as unknown as WorkspaceController,
    new SessionJobRegistry(),
    diagnostics,
    services,
  )
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: (): boolean => false,
    send: vi.fn(),
  })
  const start = (audioSourceId = 'second') =>
    mocks.handlers.get('speech-analysis:start')!(
      { sender },
      {
        workspaceToken: 'workspace',
        revision: 2,
        jobId: `job-${audioSourceId}`,
        audioSourceId,
        language: 'auto',
        draft: {},
      },
    )
  return { start, controller, resolvePcm, sources, diagnostics, sender }
}

it('generates a second imported M4A source from normalized cached PCM while retaining its original identity', async () => {
  const { start, resolvePcm, sources, controller } = setup()
  expect((await start('first')).ok).toBe(true)
  expect((await start()).ok).toBe(true)
  expect(resolvePcm).toHaveBeenLastCalledWith('second')
  expect(mocks.prepare).toHaveBeenLastCalledWith(
    { path: '/cache/second/audio.f32le', sampleRate: 48000, channels: 2 },
    expect.any(AbortSignal),
    expect.any(Function),
  )
  expect(mocks.run).toHaveBeenLastCalledWith(
    expect.objectContaining({ audioPath: '/temporary/analysis.wav', audioSource: sources[1] }),
    expect.any(AbortSignal),
    expect.any(Function),
  )
  expect(controller.commitSpeechAnalysis).toHaveBeenCalledTimes(2)
})

it('reports a safe actionable preparation failure without private paths', async () => {
  const { start, diagnostics } = setup()
  mocks.prepare.mockRejectedValue(new Error('ENOENT /private/original.m4a'))
  const result = await start()
  if (result.ok) throw new Error('Expected preparation failure')
  expect(result.error.message).toMatch(/prepare.*audio.*re-import/i)
  expect(result.error.message).not.toContain('/private')
  expect(diagnostics).toHaveBeenCalled()
})

it('reports the failed speech stage and keeps cancellation distinct', async () => {
  const { start } = setup()
  mocks.run.mockImplementation(async (_input, _signal, progress) => {
    progress({ stage: 'aligning' })
    throw new Error('/private/model failed')
  })
  const alignmentFailure = await start()
  if (alignmentFailure.ok) throw new Error('Expected alignment failure')
  expect(alignmentFailure.error.message).toMatch(/align.*retry/i)
  mocks.run.mockRejectedValue(new DOMException('cancel', 'AbortError'))
  const cancelled = await start()
  if (cancelled.ok) throw new Error('Expected cancellation')
  expect(cancelled.error.code).toBe('cancelled')
})

it('returns stable availability reasons for missing engines, workers and models', async () => {
  setup()
  const availability = mocks.handlers.get('speech-analysis:check-availability')!
  mocks.unavailableReason.mockResolvedValue({ reason: 'whisper-missing' })
  expect(await availability()).toEqual({ ok: true, value: { reason: 'whisper-missing' } })
  mocks.unavailableReason.mockResolvedValue(null)
  mocks.existsSync.mockReturnValue(false)
  expect(await availability()).toEqual({ ok: true, value: { reason: 'speech-worker-missing' } })
  mocks.existsSync.mockReturnValueOnce(true).mockReturnValue(false)
  expect(await availability()).toEqual({ ok: true, value: { reason: 'speech-models-missing' } })
})

it('timestamps preparation, real stage progress and publication using main-owned transitions', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    const { start, sender } = setup()
    mocks.run.mockImplementation(async (_input, _signal, progress) => {
      clock.mockReturnValue(2000)
      progress({ stage: 'diarizing', percent: 10 })
      clock.mockReturnValue(100000)
      progress({ stage: 'diarizing' })
      return { artifact: true }
    })
    expect((await start()).ok).toBe(true)
    expect(sender.send.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ stage: 'preparing-audio', stageStartedAtMs: 1000 }),
      expect.objectContaining({ stage: 'diarizing', percent: 10, stageStartedAtMs: 2000 }),
      expect.objectContaining({ stage: 'diarizing', stageStartedAtMs: 2000 }),
      expect.objectContaining({ stage: 'publishing', stageStartedAtMs: 100000 }),
    ])
    expect(sender.send.mock.calls[2][1]).not.toHaveProperty('percent')
    expect(sender.send.mock.calls[2][1]).not.toHaveProperty('estimatedDurationMs')
  } finally {
    clock.mockRestore()
  }
})

function deferredPreferences() {
  let resolve!: (value: { textEditingEnabled: boolean; speakerRecognitionEnabled: boolean }) => void
  const read = vi.fn(
    () =>
      new Promise<{ textEditingEnabled: boolean; speakerRecognitionEnabled: boolean }>((done) => {
        resolve = done
      }),
  )
  const services = {
    preferences: { read },
    resources: {
      getModelPaths: vi.fn(async () => ({
        whisper: '/models/whisper',
        'alignment-zh': '/models/zh',
        'alignment-en': '/models/en',
      })),
      models: [{ id: 'whisper', capability: 'transcription', files: [{ path: 'model.bin' }] }],
    },
    runtime: { getSpeechPythonPath: () => '/python', getFfmpegPath: () => '/managed/bin/ffmpeg' },
    manifestPath: '/worker/models.json',
  } as unknown as NonNullable<Parameters<typeof registerSpeechAnalysisIpc>[3]>
  return {
    services,
    read,
    resolve: (speakerRecognitionEnabled = false) =>
      resolve({ textEditingEnabled: true, speakerRecognitionEnabled }),
  }
}

it('owns cancellation before awaiting resource preferences', async () => {
  const preferences = deferredPreferences()
  const { start, sender, controller } = setup(preferences.services)
  const running = start()
  expect(preferences.read).toHaveBeenCalledOnce()
  const cancelling = mocks.handlers.get('speech-analysis:cancel')!(
    { sender },
    { workspaceToken: 'workspace', revision: 2, jobId: 'job-second' },
  )
  preferences.resolve()
  expect(await cancelling).toEqual({ ok: true, value: 'cancelled' })
  expect(await running).toMatchObject({ ok: false, error: { reason: 'cancelled' } })
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(controller.commitSpeechAnalysis).not.toHaveBeenCalled()
})

it.each(['before-start', 'during-preferences'] as const)(
  'does not launch analysis for a destroyed sender: %s',
  async (when) => {
    const preferences = deferredPreferences()
    const { start, sender } = setup(preferences.services)
    let destroyed = when === 'before-start'
    sender.isDestroyed = () => destroyed
    const running = start()
    if (when === 'during-preferences') {
      destroyed = true
      sender.emit('destroyed')
    }
    if (preferences.read.mock.calls.length) preferences.resolve()
    expect(await running).toMatchObject({ ok: false, error: { reason: 'cancelled' } })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(sender.listenerCount('destroyed')).toBe(0)
  },
)

it('does not launch a second execution when the same job is already registered', async () => {
  const preferences = deferredPreferences()
  const { start } = setup(preferences.services)
  const first = start()
  const duplicate = await start()
  expect(duplicate).toMatchObject({ ok: false })
  expect(preferences.read).toHaveBeenCalledOnce()
  preferences.resolve()
  expect(await first).toMatchObject({ ok: true })
  expect(mocks.prepare).toHaveBeenCalledOnce()
})

it('forwards only a matching measured diarization estimate after managed models resolve', async () => {
  for (const key of Object.keys(process.env))
    if (
      /^(OMP_|MKL_|OPENBLAS_|BLIS_|VECLIB_|NUMEXPR_|GOTO_|TBB_|BLAS_|ACCELERATE_|TORCH_NUM_)/.test(
        key,
      )
    )
      vi.stubEnv(key, undefined)
  vi.stubEnv('OMP_NUM_THREADS', '4')
  mocks.platform.mockReturnValue('darwin')
  mocks.architecture.mockReturnValue('arm64')
  mocks.cpus.mockReturnValue(Array.from({ length: 10 }, () => ({ model: 'Apple M4' })))
  const preferences = deferredPreferences()
  vi.mocked(preferences.services.resources.getModelPaths).mockResolvedValue({
    whisper: '/models/whisper',
    'alignment-zh': '/models/zh',
    'alignment-en': '/models/en',
    'diarization-default': '/models/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee',
  })
  const { start, sender } = setup(preferences.services)
  mocks.run.mockImplementation(async (_input, _signal, progress) => {
    progress({ stage: 'diarizing' })
    return { artifact: true }
  })
  const running = start()
  const preparation = sender.send.mock.calls[0][1]
  expect(preparation).toMatchObject({
    stage: 'preparing-audio',
    stageStartedAtMs: expect.any(Number),
  })
  expect(preparation).not.toHaveProperty('estimatedDurationMs')
  preferences.resolve(true)
  expect(await running).toMatchObject({ ok: true })
  expect(sender.send.mock.calls.find((call) => call[1].stage === 'diarizing')?.[1]).toMatchObject({
    estimatedDurationMs: 324359,
    stageStartedAtMs: expect.any(Number),
  })
})

it('routes an explicit empty all-tracks batch through resource preflight without starting engines', async () => {
  const { sender, controller } = setup()
  const result = await mocks.handlers.get('speech-analysis:start')!(
    { sender },
    {
      workspaceToken: 'workspace',
      revision: 2,
      jobId: 'all',
      scope: { kind: 'all' },
      language: 'auto',
      draft: { tracks: [] },
    },
  )
  expect(result).toMatchObject({
    ok: true,
    value: { batch: { sourceCount: 0, completedCount: 0 } },
  })
  expect(controller.assertWorkspaceCurrent).toHaveBeenCalled()
  expect(mocks.run).not.toHaveBeenCalled()
})
it('rejects unavailable shared transcription runtime before beginning a batch', async () => {
  const { sender } = setup()
  mocks.unavailableReason.mockResolvedValue({ reason: 'whisper-missing' })
  const result = await mocks.handlers.get('speech-analysis:start')!(
    { sender },
    {
      workspaceToken: 'workspace',
      revision: 2,
      jobId: 'all',
      scope: { kind: 'all' },
      language: 'auto',
      draft: { tracks: [] },
    },
  )
  expect(result).toMatchObject({ ok: false, error: { reason: 'whisper-missing' } })
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it('checks only speaker resources for a speaker-only rerun', async () => {
  const preferences = deferredPreferences()
  vi.mocked(preferences.services.resources.getModelPaths).mockResolvedValue({
    'diarization-default': '/models/speakers',
  })
  setup(preferences.services)
  mocks.unavailableReason.mockClear()
  mocks.unavailableReason.mockResolvedValue({ reason: 'whisper-missing' })
  const result = mocks.handlers.get('speech-analysis:check-availability')!(undefined, {
    text: 'skip',
    speakers: 'replace',
  })
  preferences.resolve(true)
  expect(await result).toEqual({ ok: true, value: null })
  expect(mocks.unavailableReason).not.toHaveBeenCalled()
})
it('does not require speaker resources when generating only text', async () => {
  const preferences = deferredPreferences()
  setup(preferences.services)
  const result = mocks.handlers.get('speech-analysis:check-availability')!(undefined, {
    text: 'missing',
    speakers: 'skip',
  })
  preferences.resolve(true)
  expect(await result).toEqual({ ok: true, value: null })
})

it('uses the selected Whisper file for new jobs and does not fall back to an installed alternative', async () => {
  const preferences = deferredPreferences()
  const read = vi.mocked(preferences.services.preferences.read)
  read.mockResolvedValue({
    textEditingEnabled: true,
    speakerRecognitionEnabled: false,
    whisperModelId: 'medium',
  } as Awaited<ReturnType<typeof read>>)
  preferences.services.resources.models.push({
    id: 'medium',
    capability: 'transcription',
    files: [{ path: 'ggml-medium.bin' }],
  } as (typeof preferences.services.resources.models)[number])
  const paths = vi.mocked(preferences.services.resources.getModelPaths)
  paths.mockResolvedValue({
    whisper: '/models/whisper',
    medium: '/models/medium',
    'alignment-zh': '/models/zh',
    'alignment-en': '/models/en',
  })
  const { start } = setup(preferences.services)
  expect(await start()).toMatchObject({ ok: true })
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({ transcriptionModel: '/models/medium/ggml-medium.bin' }),
    expect.any(AbortSignal),
    expect.any(Function),
  )
  paths.mockResolvedValue({
    whisper: '/models/whisper',
    'alignment-zh': '/models/zh',
    'alignment-en': '/models/en',
  })
  mocks.run.mockClear()
  expect(await start('first')).toMatchObject({ ok: false })
  expect(mocks.run).not.toHaveBeenCalled()
})
