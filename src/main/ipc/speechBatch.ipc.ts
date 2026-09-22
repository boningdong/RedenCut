import { hasSpeakerRerunImpact } from '../../shared/SpeakerRerunImpact'
import { planSpeechTasks, type SpeechTaskSelection } from '../../shared/SpeechTaskPlanner'
import type { IpcMainInvokeEvent } from 'electron'
import type { SpeechAnalysisJobRequest } from '../../shared/ipc.types'
import type { SpeechBatchProgress, SpeechBatchSummary } from '../../shared/speechBatch.types'
import type { SpeechProgress, PublicMessage } from '../../shared/publicMessages'
import type { WorkspaceController } from '../project/WorkspaceController'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import { assertSpeechGuard } from '../project/BackgroundCommitPolicy'
import type { SpeechAnalysisCoordinator } from '../speech/SpeechAnalysisCoordinator'
import { SpeechBatchCoordinator } from '../speech/SpeechBatchCoordinator'
import { planSpeechSources } from '../speech/SpeechBatchPlanner'
import { SpeechArtifactStore } from '../speech/SpeechArtifactStore'
import { SpeechAnalysisError } from '../speech/SpeechAnalysisError'
import { SpeechStagePolicy } from '../speech/SpeechStagePolicy'
import { measuredSpeechProfiles } from '../speech/measuredSpeechProfiles'
import { withSpeechAudio } from '../speech/prepareSpeechAudio'
import { TranscriberUnavailableError } from '../speech/transcriber/TranscriberUnavailableError'
import { PublicIpcError } from './ipcResult'

interface SpeechBatchRuntime {
  speakerRecognitionEnabled: boolean
  modelPaths?: Record<string, string>
  transcriptionModel?: string
  configuration: string
}
interface Dependencies {
  controller: WorkspaceController
  jobs: SessionJobRegistry
  coordinator: Pick<SpeechAnalysisCoordinator, 'transcribeAndAlign' | 'identifySpeakers'>
  prepare(tasks?: SpeechTaskSelection): Promise<SpeechBatchRuntime>
  diagnosticSink(error: unknown): void
}

/** Compose the batch with workspace guards and IPC; the scheduler stays engine-independent. */
export function createSpeechBatchHandler({
  controller,
  jobs,
  coordinator,
  prepare,
  diagnosticSink,
}: Dependencies) {
  const active = new Set<string>()
  return async (event: IpcMainInvokeEvent, request: SpeechAnalysisJobRequest) => {
    controller.assertWorkspaceCurrent(request)
    if (!request.scope || active.has(request.workspaceToken))
      throw new PublicIpcError('invalid-request')
    const ids = planSpeechSources(request.scope, request.draft.tracks)
    const project = controller.workspace.project
    const contexts = ids.map((id) => {
      const source = project.audioSources.find((source) => source.id === id)
      if (!source) throw new PublicIpcError('invalid-request')
      if (
        (request.mode === 'regenerate' ||
          request.tasks?.text === 'replace' ||
          request.tasks?.speakers === 'replace') &&
        !request.confirmSpeakerLabelReset &&
        (hasSpeakerRerunImpact(project.speakerIdentities, new Set([id])) ||
          project.speakerLabelOverrides.some((override) => override.audioSourceId === id))
      )
        throw new PublicIpcError('invalid-request')
      const guard = controller.captureBackgroundSpeechGuard(request, id)
      const cached = controller.workspace.speechArtifacts.find(
        (artifact) => artifact.audioSourceId === id,
      )
      const valid =
        cached &&
        cached.sourceFingerprint.sha256 === source.fingerprint.sha256 &&
        cached.sourceFingerprint.byteLength === source.fingerprint.byteLength &&
        cached.sourceFingerprint.modifiedTimeMs === source.fingerprint.modifiedTimeMs
      return {
        source: structuredClone(source),
        guard,
        artifact: valid ? cached : undefined,
      }
    })
    const resolvePcm = controller.captureBackgroundSpeechPcmResolver(request)
    const identity = {
      kind: 'speech-analysis' as const,
      jobId: request.jobId,
      senderId: event.sender.id,
      workspaceToken: request.workspaceToken,
      revision: request.revision,
    }
    const abort = new AbortController()
    active.add(request.workspaceToken)
    const run = async () => {
      if (event.sender.isDestroyed()) abort.abort()
      abort.signal.throwIfAborted()
      const preview = request.tasks
        ? planSpeechTasks(
            contexts.map((context) => ({
              audioSourceId: context.source.id,
              text: !!context.artifact,
              speakers: !!context.artifact?.diarization,
            })),
            request.tasks,
          )
        : undefined
      if (preview?.missingText.length) throw new PublicIpcError('invalid-request')
      const runtime = await prepare(
        request.tasks && preview
          ? {
              text: preview.text.length ? request.tasks.text : 'skip',
              speakers: preview.speakers.length ? request.tasks.speakers : 'skip',
            }
          : undefined,
      )
      const tasks =
        request.tasks ??
        ({
          text: request.mode === 'regenerate' ? 'replace' : 'missing',
          speakers: runtime.speakerRecognitionEnabled
            ? request.mode === 'regenerate'
              ? 'replace'
              : 'missing'
            : 'skip',
        } as SpeechTaskSelection)
      abort.signal.throwIfAborted()
      let lastBatch: SpeechBatchProgress | undefined
      const trackers = new Map<string, ReturnType<SpeechStagePolicy['createProgressTracker']>>()
      const report = (progress: SpeechProgress, batch: SpeechBatchProgress) => {
        lastBatch = batch
        const key = `${batch.audioSourceId}/${batch.phase}`
        let track = trackers.get(key)
        if (!track) {
          track = new SpeechStagePolicy(measuredSpeechProfiles).createProgressTracker(
            contexts.find((context) => context.source.id === batch.audioSourceId)?.source.metadata
              ?.durationSeconds ?? 0,
            runtime.configuration,
          )
          trackers.set(key, track)
        }
        if (!event.sender.isDestroyed())
          event.sender.send('speech-analysis:progress', { ...identity, ...track(progress), batch })
      }
      const analyze = async (
        id: string,
        progress: (event: SpeechProgress) => void,
        existing?: Parameters<SpeechAnalysisCoordinator['identifySpeakers']>[1],
      ) => {
        let stage: SpeechProgress['stage'] = 'preparing-audio'
        const context = contexts.find((context) => context.source.id === id)!
        const onProgress = (event: SpeechProgress) => {
          stage = event.stage
          progress(event)
        }
        try {
          controller.assertWorkspaceCurrent(request)
          assertSpeechGuard(controller.workspace.project, context.guard)
          abort.signal.throwIfAborted()
          const pcm = await resolvePcm(context.source.id)
          return await withSpeechAudio(pcm, abort.signal, (audioPath) => {
            const input = {
              jobId: `${request.jobId}:${id}:${existing ? 'speakers' : 'text'}`,
              audioPath,
              audioSource: context.source,
              language: request.language,
              alignmentModel: 'auto',
              diarizationModel: 'diarization-default',
              speakerRecognitionEnabled: tasks.speakers !== 'skip',
              replaceSpeakers: tasks.speakers === 'replace',
              modelPaths: runtime.modelPaths,
              transcriptionModel: runtime.transcriptionModel,
            }
            return existing
              ? coordinator.identifySpeakers(input, existing, abort.signal, onProgress)
              : coordinator.transcribeAndAlign(input, abort.signal, onProgress)
          })
        } catch (error) {
          if (abort.signal.aborted) abort.signal.throwIfAborted()
          throw new SpeechAnalysisError(stage, error)
        }
      }
      const batch = new SpeechBatchCoordinator({
        analyzeText: (source, _signal, progress) => analyze(source.audioSourceId, progress),
        analyzeSpeakers: (source, artifact, _signal, progress) =>
          analyze(source.audioSourceId, progress, artifact),
        publish: async (source, artifact, signal) => {
          signal.throwIfAborted()
          const context = contexts.find((context) => context.source.id === source.audioSourceId)!
          try {
            const reference = new SpeechArtifactStore(controller.workspace.root).prepare(
              artifact,
            ).reference
            const session = await controller.commitBackgroundSpeechAnalysis(
              context.guard,
              artifact,
              signal,
            )
            // Derive the next expectation from OUR published bytes, never a later competing result.
            context.guard = {
              ...context.guard,
              expectedSpeakerLabelOverrides: [],
              expectedAnalysis: {
                analysisRevisionId: reference.analysisRevisionId,
                artifactSha256: reference.artifactSha256,
              },
            }
            if (!event.sender.isDestroyed())
              event.sender.send('speech-analysis:progress', {
                ...identity,
                stage: 'publishing',
                batch: lastBatch,
                session,
              })
          } catch (error) {
            throw new SpeechAnalysisError('publishing', error)
          }
        },
        publicFailure: (error): PublicMessage => {
          diagnosticSink(error)
          if (error instanceof SpeechAnalysisError)
            return {
              reason: `speech-${error.stage}`,
              ...(error.failureKind ? { failureKind: error.failureKind } : {}),
            }
          if (error instanceof TranscriberUnavailableError) return { reason: error.reason }
          return { reason: 'operation-failed' }
        },
      })
      const summary: SpeechBatchSummary = await batch.run(
        contexts.map((context) => ({
          audioSourceId: context.source.id,
          displayName: context.source.displayName,
          artifact: context.artifact,
        })),
        tasks,
        abort.signal,
        report,
      )
      abort.signal.throwIfAborted()
      controller.assertWorkspaceCurrent(request)
      return { ...identity, value: await controller.describe(abort.signal), batch: summary }
    }
    let settled!: ReturnType<typeof run>
    let unregister: (() => void) | undefined
    const cancel = () => {
      void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
    }
    try {
      unregister = jobs.register(identity, () => {
        settled = run()
        return { cancel: () => abort.abort(), settled }
      })
      event.sender.once('destroyed', cancel)
      return await settled
    } finally {
      event.sender.removeListener('destroyed', cancel)
      unregister?.()
      active.delete(request.workspaceToken)
    }
  }
}
