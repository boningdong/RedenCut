import { expect, it } from 'vitest'
import { createSpeechBatchHandler } from './speechBatch.ipc'
import { createEmptyProject } from '../../shared/ProjectTypes'
import type { WorkspaceController } from '../project/WorkspaceController'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import type { SpeechAnalysisJobRequest } from '../../shared/ipc.types'
import type { IpcMainInvokeEvent } from 'electron'

it('rejects unconfirmed reruns of identities saved only in the current catalog', async () => {
  const project = createEmptyProject()
  const sourceId = '00000000-0000-4000-8000-000000000001' as never
  project.audioSources = [
    {
      id: sourceId,
      displayName: 'Source',
      location: { mode: 'reference', path: '/source.wav' },
      fingerprint: { sha256: 'a'.repeat(64), byteLength: 100, modifiedTimeMs: 0 },
      metadata: {
        durationSeconds: 1,
        sampleRate: 48000,
        channels: 1,
        codec: 'pcm_f32le',
        bitrateKbps: 1536,
      },
    },
  ]
  project.speakerIdentities = {
    version: 1,
    people: [
      {
        id: 'host',
        displayName: 'Host',
        color: '#112233',
        binding: {
          audioSourceId: sourceId,
          analysisRevisionId: 'revision' as never,
          speakerId: 'speaker' as never,
        },
      },
    ],
    associations: [],
  }
  const controller = {
    assertWorkspaceCurrent() {},
    workspace: { project },
    captureBackgroundSpeechGuard() {
      throw new Error('Rerun passed confirmation guard')
    },
  } as unknown as WorkspaceController
  const handler = createSpeechBatchHandler({
    controller,
    jobs: {} as SessionJobRegistry,
    coordinator: {} as never,
    prepare: async () => ({ speakerRecognitionEnabled: true, configuration: 'test' }),
    diagnosticSink() {},
  })
  await expect(
    handler(
      {} as IpcMainInvokeEvent,
      {
        workspaceToken: 'workspace',
        scope: { kind: 'all' },
        tasks: { text: 'skip', speakers: 'replace' },
        draft: { tracks: [{ clips: [{ audioSourceId: sourceId }] }] },
      } as unknown as SpeechAnalysisJobRequest,
    ),
  ).rejects.toMatchObject({ code: 'invalid-request' })
})
