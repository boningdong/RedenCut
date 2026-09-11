import { EventEmitter } from 'events'
import type { IpcResult } from '../../shared/ipc.types'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WorkspaceController } from '../project/WorkspaceController'
import { SessionJobRegistry } from '../project/SessionJobRegistry'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<IpcResult<unknown>>>(),
  run: vi.fn(),
  prepare: vi.fn(),
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
vi.mock('../transcriber/whisper', () => ({ whisperTranscriber: {} }))
import { registerSpeechAnalysisIpc } from './speechAnalysis.ipc'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.run.mockReset()
  mocks.prepare.mockReset()
})

function setup() {
  const sources = [
    { id: 'first', fingerprint: { sha256: 'wav-original' } },
    { id: 'second', fingerprint: { sha256: 'm4a-original' } },
  ]
  const resolvePcm = vi.fn(async (id: string) => ({
    path: `/cache/${id}/audio.f32le`,
    sampleRate: 48000,
    channels: 2,
  }))
  const controller = {
    workspace: { project: { audioSources: sources, speakerLabelOverrides: [] } },
    assertCurrent: vi.fn(),
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
  )
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
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
  return { start, controller, resolvePcm, sources, diagnostics }
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
