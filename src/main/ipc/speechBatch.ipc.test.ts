import { EventEmitter } from 'events'
import { expect, it, vi } from 'vitest'
import type { AppLogEvent } from '../../shared/diagnostics.types'
import type { WorkspaceController } from '../project/WorkspaceController'
import { SessionJobRegistry } from '../project/SessionJobRegistry'
import { createSpeechBatchHandler } from './speechBatch.ipc'
vi.mock('../speech/prepareSpeechAudio', () => ({
  withSpeechAudio: async (_pcm: unknown, _signal: unknown, analyze: (path: string) => unknown) =>
    analyze('/normalized.wav'),
}))
vi.mock('../speech/SpeechArtifactStore', () => ({
  SpeechArtifactStore: class {
    prepare(artifact: { analysisRevisionId: string }) {
      return {
        reference: { analysisRevisionId: artifact.analysisRevisionId, artifactSha256: 'hash' },
      }
    }
  },
}))
function setup(failureLog?: { write: (event: AppLogEvent) => Promise<void> }) {
  const fingerprint = { byteLength: 1, modifiedTimeMs: 0, sha256: 'a'.repeat(64) }
  const sources = ['A', 'B'].map((id) => ({ id, displayName: id, fingerprint }))
  let revision = 2
  const guards = new Map()
  const artifacts = new Map()
  const sessions: unknown[] = []
  const controller = {
    workspace: {
      root: '/workspace',
      project: { audioSources: sources, speakerLabelOverrides: [], speechArtifacts: [] },
      speechArtifacts: [],
    },
    assertWorkspaceCurrent: vi.fn(),
    captureBackgroundSpeechGuard: (_request: unknown, id: string) => ({
      workspaceToken: 'workspace',
      audioSourceId: id,
      sourceFingerprint: fingerprint,
      expectedAnalysis: guards.get(id) ?? null,
      expectedSpeakerLabelOverrides: [],
    }),
    captureBackgroundSpeechPcmResolver: () => async () => ({
      path: '/pcm',
      sampleRate: 48000,
      channels: 1,
    }),
    commitBackgroundSpeechAnalysis: async (guard: { audioSourceId: string }, artifact: unknown) => {
      artifacts.set(guard.audioSourceId, artifact)
      guards.set(guard.audioSourceId, { analysisRevisionId: 'analysis', artifactSha256: 'hash' })
      revision++
      const session = { workspaceToken: 'workspace', revision }
      sessions.push(session)
      return session
    },
    describe: async () => ({ workspaceToken: 'workspace', revision }),
  }
  const calls: string[] = []
  const coordinator = {
    transcribeAndAlign: vi.fn(
      async (
        input: { audioSource: { id: string }; speakerRecognitionEnabled: boolean },
        _signal: AbortSignal,
      ) => {
        calls.push(input.audioSource.id)
        return {
          audioSourceId: input.audioSource.id,
          analysisRevisionId: 'analysis',
          sourceFingerprint: fingerprint,
        }
      },
    ),
    identifySpeakers: vi.fn(),
  }
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    send: vi.fn(),
  })
  const jobs = new SessionJobRegistry()
  const handler = createSpeechBatchHandler({
    controller: controller as unknown as WorkspaceController,
    jobs,
    coordinator: coordinator as never,
    prepare: async () => ({ speakerRecognitionEnabled: false, configuration: 'uncalibrated' }),
    diagnosticSink: vi.fn(),
    failureLog,
  })
  const request = {
    workspaceToken: 'workspace',
    revision: 1,
    jobId: 'batch',
    scope: { kind: 'all' },
    language: 'auto',
    draft: {
      tracks: [
        { id: 'empty', clips: [] },
        { id: 'first', clips: [{ audioSourceId: 'A' }, { audioSourceId: 'B' }] },
        { id: 'second', clips: [{ audioSourceId: 'A' }] },
      ],
    },
  } as never
  return { handler, request, sender, calls, sessions, controller, coordinator, jobs }
}
it('processes all unique sources and publishes progress across project revision advances', async () => {
  const { handler, request, sender, calls, sessions } = setup()
  const result = await handler({ sender } as never, request)
  expect(calls).toEqual(['A', 'B'])
  expect(sessions).toHaveLength(2)
  expect(result.batch.completedCount).toBe(2)
  expect(result.value.revision).toBe(4)
  expect(sender.send.mock.calls.filter(([, event]) => event.session)).toHaveLength(2)
})

it('assigns distinct diagnostic IDs to two failed sources and records one error each', async () => {
  const failureLog = { write: vi.fn(async (_event: AppLogEvent) => {}) }
  const { handler, request, sender, coordinator } = setup(failureLog)
  coordinator.transcribeAndAlign.mockRejectedValue(new Error('/private/audio.wav'))
  const result = await handler({ sender } as never, request)
  expect(result.batch.failures).toHaveLength(2)
  const ids = result.batch.failures.map(
    (failure: { error: { diagnosticId?: string } }) => failure.error.diagnosticId,
  )
  expect(ids[0]).toBeTruthy()
  expect(ids[1]).toBeTruthy()
  expect(ids[0]).not.toBe(ids[1])
  expect(failureLog.write.mock.calls.filter(([event]) => event.level === 'error')).toHaveLength(2)
  expect(JSON.stringify(failureLog.write.mock.calls)).not.toContain('/private/')
})
it('rejects simultaneous batches in the same workspace', async () => {
  const { handler, request, sender, coordinator } = setup()
  let release!: () => void
  coordinator.transcribeAndAlign.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return {} as never
  })
  const first = handler({ sender } as never, request)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(
    handler({ sender } as never, { ...(request as object), jobId: 'another' } as never),
  ).rejects.toThrow()
  release()
  await first
})

it('settles cancelled inference without requesting a workspace snapshot behind a switching lock', async () => {
  const { handler, request, sender, coordinator, controller, jobs } = setup()
  coordinator.transcribeAndAlign.mockImplementationOnce(
    async (_input, signal: AbortSignal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      ),
  )
  controller.describe = vi.fn(async () => {
    throw new Error('Snapshot would wait for switching lock')
  })
  const result = handler({ sender } as never, request).catch((error) => error)
  await vi.waitFor(() => expect(coordinator.transcribeAndAlign).toHaveBeenCalled())
  jobs.beginClosing('workspace' as never)
  await jobs.cancelAndSettleToken('workspace' as never)
  expect(await result).toMatchObject({ name: 'AbortError' })
  expect(controller.describe).not.toHaveBeenCalled()
})
