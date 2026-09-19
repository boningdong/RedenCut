import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
import { ProjectFileSchema } from '../../shared/ProjectTypes'
import type { WorkspaceToken } from '../../shared/session.types'
import { SpeechWorkerResponseSchema } from '../../shared/speechWorker.types'
import { toRendererSession } from '../project/sessionProjection'
import { SpeechAnalysisCoordinator } from './SpeechAnalysisCoordinator'
import { SpeechArtifactStore } from './SpeechArtifactStore'

const engine = {
  engineId: 'whisperx',
  engineVersion: '3',
  modelId: 'alignment-en',
  configHash: 'a'.repeat(64),
  artifactSchemaVersion: 1,
  createdAt: '2026-09-14T00:00:00.000Z',
}
const recoveryProvenance = {
  algorithmId: 'anchor-recovery',
  algorithmVersion: '1',
  configHash: 'b'.repeat(64),
  artifactSchemaVersion: 1,
  createdAt: engine.createdAt,
}

it.each(['pending', 'completed', 'skipped-disabled'] as const)(
  'retains recovery evidence from worker through stored %s artifact and renderer session',
  async (status) => {
    const root = await mkdtemp(join(tmpdir(), 'recovery-contract-'))
    try {
      const coordinator = new SpeechAnalysisCoordinator(
        {
          transcribe: async () => ({
            text: 'hello world',
            detectedLanguage: 'en',
            verbatimCapability: 'best-effort-verbatim',
            evidence: [{ text: 'hello world' }],
            provenance: engine,
          }),
        },
        {
          run: async (request) => {
            const ids = request
              .transcriptUnits!.filter((unit) => unit.kind === 'speech')
              .map((unit) => unit.id)
            const response = SpeechWorkerResponseSchema.parse({
              protocolVersion: 1,
              jobId: request.jobId,
              type: 'result',
              result: {
                phase: 'alignment',
                alignment: {
                  units: ids.map((id, index) => ({
                    transcriptUnitIds: [id],
                    sourceStart: index,
                    sourceEnd: index + 0.8,
                    granularity: 'word',
                    timingOrigin: index ? 'anchor-inferred' : 'aligned',
                    ...(index ? { evidenceAnchorTextUnitIds: [ids[0]] } : {}),
                  })),
                  unalignedTranscriptUnitIds: [],
                  validation: { version: 1, method: 'audio-evidence' },
                  recoveryVersion: 1,
                  observations: [
                    {
                      transcriptUnitIds: [ids[0]],
                      candidateStart: 0,
                      candidateEnd: 0.8,
                      confidence: 0.9,
                      audioEvidence: 'non-silent',
                      reason: 'accepted',
                      timingOrigin: 'aligned',
                    },
                    {
                      transcriptUnitIds: [ids[1]],
                      candidateStart: -1,
                      candidateEnd: -2,
                      audioEvidence: 'unknown',
                      reason: 'invalid-bounds',
                    },
                  ],
                  recoveryProvenance,
                  provenance: engine,
                },
              },
            })
            if (response.type !== 'result') throw new Error('Expected result')
            return response.result
          },
        },
        () => crypto.randomUUID(),
      )
      const input = {
        jobId: 'job',
        audioPath: '/tmp/fixture.wav',
        audioSource: {
          id: crypto.randomUUID(),
          fingerprint: { byteLength: 1, modifiedTimeMs: 0, sha256: 'c'.repeat(64) },
        },
        language: 'en',
        alignmentModel: 'alignment-en',
        diarizationModel: 'diarization-default',
        speakerRecognitionEnabled: status !== 'skipped-disabled',
      }
      const signal = new AbortController().signal
      let artifact = await coordinator.transcribeAndAlign(input, signal)
      if (status === 'completed')
        artifact = await new SpeechAnalysisCoordinator(
          {
            transcribe: async () => {
              throw new Error('Must not transcribe twice')
            },
          },
          {
            run: async () => ({
              phase: 'diarization',
              diarization: { status: 'completed', turns: [], provenance: engine },
            }),
          },
          () => crypto.randomUUID(),
        ).identifySpeakers(input, artifact, signal)
      expect(artifact.alignment).toMatchObject({
        recoveryVersion: 1,
        recoveryProvenance,
        observations: [
          { reason: 'accepted' },
          { candidateStart: -1, candidateEnd: -2, reason: 'invalid-bounds' },
        ],
        acousticEditUnits: [{ timingOrigin: 'aligned' }, { timingOrigin: 'anchor-inferred' }],
      })
      const store = new SpeechArtifactStore(root)
      const prepared = store.prepare(artifact)
      await store.publish(await store.stage(prepared))
      const loaded = await store.load(prepared.reference)
      expect(loaded).toEqual(artifact)
      const project = ProjectFileSchema.parse({
        version: 2,
        createdAt: engine.createdAt,
        audioSettings: { processingSampleRate: 48000 },
        audioSources: [],
        tracks: [],
        speechArtifacts: [],
        speakerLabelOverrides: [],
        adjustments: [],
        markers: [],
        export: { format: 'wav', targetLUFS: -14, truePeakDbTP: -1, sampleRate: 48000 },
        pluginData: {},
      })
      const projected = toRendererSession(
        {
          project,
          descriptor: { kind: 'saved', displayName: 'Fixture', portable: false },
          speechArtifacts: [loaded],
        },
        'fixture' as WorkspaceToken,
        1,
        [],
      ).speechAnalyses[0]
      expect(projected.diarizationStatus).toBe(status)
      expect(projected.alignment).toMatchObject({
        validation: artifact.alignment.validation,
        recoveryVersion: 1,
        recoveryProvenance,
        observations: artifact.alignment.observations,
        acousticEditUnits: loaded.alignment.acousticEditUnits,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
