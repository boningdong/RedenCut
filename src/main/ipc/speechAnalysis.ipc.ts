import { z } from 'zod'
import { SpeechTaskSelectionSchema } from '../../shared/SpeechTaskPlanner'
import { AppLogEvents } from '../../shared/diagnostics.types'
import { selectWhisperDefinition } from '../resources/WhisperModelSelection'
import { createSpeechBatchHandler } from './speechBatch.ipc'
import { TrackSchema } from '../../shared/ProjectTypes'
import type { ResourceManager } from '../resources/ResourceManager'
import type { AppPreferencesStore } from '../preferences/AppPreferencesStore'
import { AppRuntimeLocator } from '../runtime/AppRuntimeLocator'
import { TranscriberUnavailableError } from '../speech/transcriber/TranscriberUnavailableError'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir, platform, arch, cpus } from 'os'
import { ipcMain } from 'electron'
import type {
  CancelSessionJobRequest,
  SessionJobResult,
  SpeechAnalysisJobId,
  SpeechAnalysisJobRequest,
} from '../../shared/ipc.types'
import type { TranscriptionCancellationResult } from '../../shared/transcriber.types'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import type { WorkspaceController } from '../project/WorkspaceController'
import { SpeechStagePolicy } from '../speech/SpeechStagePolicy'
import {
  measuredSpeechProfiles,
  measuredSpeechConfiguration,
} from '../speech/measuredSpeechProfiles'
import type { SpeechProgress } from '../../shared/publicMessages'
import { SpeechAnalysisCoordinator } from '../speech/SpeechAnalysisCoordinator'
import { withSpeechAudio } from '../speech/prepareSpeechAudio'
import { SpeechAnalysisError, type SpeechFailureStage } from '../speech/SpeechAnalysisError'
import { SpeechWorkerClient } from '../speech/SpeechWorkerClient'
import type { DiagnosticLog } from '../diagnostics/DiagnosticLog'
import { classifySpeechFailure } from '../speech/classifySpeechFailure'
import { whisperTranscriber } from '../speech/transcriber/whisper'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

interface SpeechPreparationServices {
  resources: ResourceManager
  preferences: AppPreferencesStore
  runtime: AppRuntimeLocator
  manifestPath: string
}

export function registerSpeechAnalysisIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: (error: unknown) => void = console.error,
  services?: SpeechPreparationServices,
  failureLog?: Pick<DiagnosticLog, 'write'>,
): void {
  const workerRoot = services
    ? dirname(services.manifestPath)
    : (process.env.REDENCUT_SPEECH_WORKER_ROOT ?? join(process.cwd(), 'speech-worker'))
  let managedWhisper: string | null = null
  if (services) whisperTranscriber.setModelResolver(() => managedWhisper)
  const runtime =
    services?.runtime ??
    new AppRuntimeLocator({
      packaged: false,
      resourcesPath: '',
      appPath: process.cwd(),
    })
  const python = () => {
    try {
      return runtime.getSpeechPythonPath()
    } catch {
      // Registration remains available so the UI can explain a missing runtime.
      return ''
    }
  }
  const manifest =
    services?.manifestPath ??
    process.env.REDENCUT_SPEECH_MANIFEST ??
    join(workerRoot, 'models.json')
  const modelCache =
    process.env.REDENCUT_SPEECH_MODEL_CACHE ??
    join(homedir(), 'Library', 'Caches', 'RedenCut', 'speech-models')
  const workerEnvironment = () => ({
    ...process.env,
    PATH: dirname(runtime.getFfmpegPath()),
    PYTHONPATH: join(workerRoot, 'src'),
    REDENCUT_SPEECH_MANIFEST: manifest,
    REDENCUT_SPEECH_MODEL_CACHE: modelCache,
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
  })
  const worker = new SpeechWorkerClient(python, ['-m', 'redencut_speech_worker'], {
    cwd: workerRoot,
    env: workerEnvironment,
  })
  const coordinator = new SpeechAnalysisCoordinator(whisperTranscriber, worker, randomUUID)

  ipcMain.handle('speech-analysis:check-availability', (_event, input: unknown) =>
    toIpcResult(async () => {
      const tasks = input === undefined ? undefined : SpeechTaskSelectionSchema.parse(input)
      const needsText = !tasks || tasks.text !== 'skip'
      if (services) {
        const preferences = await services.preferences.read()
        if (!preferences.textEditingEnabled) return { reason: 'speech-models-missing' as const }
        const paths = await services.resources.getModelPaths()
        const transcription = selectWhisperDefinition(
          services.resources.models,
          preferences?.whisperModelId,
        )!
        managedWhisper = paths[transcription.id]
          ? join(paths[transcription.id], transcription.files[0].path)
          : null
        if (
          (needsText && (!managedWhisper || !paths['alignment-zh'] || !paths['alignment-en'])) ||
          ((tasks ? tasks.speakers !== 'skip' : preferences.speakerRecognitionEnabled) &&
            !paths['diarization-default'])
        )
          return { reason: 'speech-models-missing' as const }
      }
      const whisperReason = needsText ? await whisperTranscriber.unavailableReason() : null
      if (whisperReason) return whisperReason
      if (!existsSync(python())) return { reason: 'speech-worker-missing' as const }
      if (!existsSync(manifest) || (!services && !existsSync(modelCache)))
        return { reason: 'speech-models-missing' as const }
      return null
    }, diagnosticSink),
  )

  const runBatch = createSpeechBatchHandler({
    controller,
    jobs,
    coordinator,
    diagnosticSink,
    failureLog,
    prepare: async (tasks) => {
      if (!python() || !existsSync(python()))
        throw new TranscriberUnavailableError('speech-worker-missing')
      const preferences = services ? await services.preferences.read() : undefined
      const modelPaths = services ? await services.resources.getModelPaths() : undefined
      const needsText = !tasks || tasks.text !== 'skip'
      const needsSpeakers = tasks
        ? tasks.speakers !== 'skip'
        : (preferences?.speakerRecognitionEnabled ?? true)
      let transcriptionModel: string | undefined
      if (services && modelPaths) {
        const model = selectWhisperDefinition(
          services.resources.models,
          preferences?.whisperModelId,
        )!
        if (
          !preferences?.textEditingEnabled ||
          (needsText &&
            (!modelPaths[model.id] ||
              !modelPaths['alignment-zh'] ||
              !modelPaths['alignment-en'])) ||
          (needsSpeakers && !modelPaths['diarization-default'])
        )
          throw new TranscriberUnavailableError('speech-models-missing')
        transcriptionModel = needsText ? join(modelPaths[model.id], model.files[0].path) : undefined
        managedWhisper = transcriptionModel ?? null
      }
      const unavailable = needsText ? await whisperTranscriber.unavailableReason() : null
      if (unavailable)
        throw new TranscriberUnavailableError(
          unavailable.reason as ConstructorParameters<typeof TranscriberUnavailableError>[0],
        )
      if (!existsSync(manifest) || (!services && !existsSync(modelCache)))
        throw new TranscriberUnavailableError('speech-models-missing')
      return {
        speakerRecognitionEnabled: preferences?.speakerRecognitionEnabled ?? true,
        modelPaths,
        transcriptionModel,
        configuration: measuredSpeechConfiguration({
          platform: platform(),
          architecture: arch(),
          cpuModels: cpus().map((cpu) => cpu.model),
          device: 'cpu',
          modelPaths,
          environment: workerEnvironment(),
        }),
      }
    },
  })

  const activeAnalyses = new Set<string>()
  ipcMain.handle('speech-analysis:start', (event, input: unknown) =>
    toIpcResult(
      async (): Promise<
        SessionJobResult<Awaited<ReturnType<WorkspaceController['describe']>>, SpeechAnalysisJobId>
      > => {
        const request = parseStartRequest(input)
        if (activeAnalyses.has(request.workspaceToken)) throw new PublicIpcError('invalid-request')
        activeAnalyses.add(request.workspaceToken)
        try {
          if (request.scope) return await runBatch(event, request)
          controller.assertCurrent(request)
          const source = controller.workspace.project.audioSources.find(
            (candidate) => candidate.id === request.audioSourceId,
          )
          if (!source) throw new PublicIpcError('invalid-request')
          if (
            controller.workspace.project.speakerLabelOverrides.some(
              (override) => override.audioSourceId === request.audioSourceId,
            ) &&
            !request.confirmSpeakerLabelReset
          )
            throw new PublicIpcError('invalid-request')
          if (services && !python()) throw new TranscriberUnavailableError('speech-worker-missing')
          const identity = {
            kind: 'speech-analysis' as const,
            jobId: request.jobId,
            senderId: event.sender.id,
            workspaceToken: request.workspaceToken,
            revision: request.revision,
          }
          const abortController = new AbortController()
          const run = async () => {
            let stage: SpeechFailureStage = 'preparing-audio'
            let loggedStage: SpeechProgress['stage'] | null = null
            let configuration = 'uncalibrated'
            const trackProgress = new SpeechStagePolicy(
              measuredSpeechProfiles,
            ).createProgressTracker(source.metadata?.durationSeconds ?? 0, () => configuration)
            const reportProgress = (progress: SpeechProgress) => {
              if (failureLog && loggedStage !== progress.stage) {
                if (loggedStage)
                  void failureLog.write({
                    schemaVersion: 1,
                    time: new Date().toISOString(),
                    level: 'info',
                    event: AppLogEvents.SpeechStageCompleted,
                    operationId: request.jobId,
                    facts: { stage: loggedStage },
                  })
                void failureLog.write({
                  schemaVersion: 1,
                  time: new Date().toISOString(),
                  level: 'info',
                  event: AppLogEvents.SpeechStageStarted,
                  operationId: request.jobId,
                  facts: { stage: progress.stage },
                })
                loggedStage = progress.stage
              }
              stage = progress.stage
              if (!event.sender.isDestroyed())
                event.sender.send('speech-analysis:progress', {
                  ...identity,
                  ...trackProgress(progress),
                })
            }
            try {
              if (event.sender.isDestroyed()) abortController.abort()
              abortController.signal.throwIfAborted()
              reportProgress({ stage: 'preparing-audio' })
              const preferences = services ? await services.preferences.read() : undefined
              abortController.signal.throwIfAborted()
              const modelPaths = services ? await services.resources.getModelPaths() : undefined
              abortController.signal.throwIfAborted()
              let transcriptionModel: string | undefined
              if (services && modelPaths) {
                const model = selectWhisperDefinition(
                  services.resources.models,
                  preferences?.whisperModelId,
                )!
                if (
                  !preferences?.textEditingEnabled ||
                  !modelPaths[model.id] ||
                  !modelPaths['alignment-zh'] ||
                  !modelPaths['alignment-en'] ||
                  (preferences.speakerRecognitionEnabled && !modelPaths['diarization-default'])
                )
                  throw new TranscriberUnavailableError('speech-models-missing')
                transcriptionModel = join(modelPaths[model.id], model.files[0].path)
                managedWhisper = transcriptionModel
              }
              configuration = measuredSpeechConfiguration({
                platform: platform(),
                architecture: arch(),
                cpuModels: cpus().map((cpu) => cpu.model),
                device: 'cpu',
                modelPaths,
                environment: workerEnvironment(),
              })
              const resolvePcm = controller.captureSpeechPcmResolver(request)
              abortController.signal.throwIfAborted()
              const pcm = await resolvePcm(source.id)
              const artifact = await withSpeechAudio(pcm, abortController.signal, (audioPath) =>
                coordinator.run(
                  {
                    jobId: request.jobId,
                    audioPath,
                    audioSource: source,
                    language: request.language,
                    alignmentModel: 'auto',
                    diarizationModel: 'diarization-default',
                    speakerRecognitionEnabled: preferences?.speakerRecognitionEnabled ?? true,
                    modelPaths,
                    transcriptionModel,
                  },
                  abortController.signal,
                  reportProgress,
                ),
              )
              abortController.signal.throwIfAborted()
              reportProgress({ stage: 'publishing' })
              const session = await controller.commitSpeechAnalysis(
                request,
                artifact,
                request.draft,
              )
              if (failureLog && loggedStage)
                void failureLog.write({
                  schemaVersion: 1,
                  time: new Date().toISOString(),
                  level: 'info',
                  event: AppLogEvents.SpeechStageCompleted,
                  operationId: request.jobId,
                  facts: { stage: loggedStage },
                })
              return {
                jobId: request.jobId,
                workspaceToken: request.workspaceToken,
                revision: request.revision,
                value: session,
              }
            } catch (error) {
              if (abortController.signal.aborted) abortController.signal.throwIfAborted()
              if (error instanceof DOMException && error.name === 'AbortError') throw error
              if (
                error instanceof TranscriberUnavailableError ||
                error instanceof PublicIpcError ||
                (error instanceof Error &&
                  (error.message === 'Stale workspace token' ||
                    error.message === 'Stale workspace revision'))
              )
                throw error
              throw new SpeechAnalysisError(stage, error)
            }
          }
          let settled!: ReturnType<typeof run>
          const unregister = jobs.register(identity, () => {
            settled = run()
            return { cancel: () => abortController.abort(), settled }
          })
          const cancelSenderJobs = () => {
            void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
          }
          event.sender.once('destroyed', cancelSenderJobs)
          try {
            return await settled
          } finally {
            event.sender.removeListener('destroyed', cancelSenderJobs)
            unregister()
          }
        } finally {
          activeAnalyses.delete(request.workspaceToken)
        }
      },
      diagnosticSink,
      failureLog
        ? {
            log: failureLog,
            operationId:
              typeof (input as { jobId?: unknown })?.jobId === 'string'
                ? (input as { jobId: string }).jobId
                : randomUUID(),
            stage: 'aligning',
            classify: (error: unknown) =>
              classifySpeechFailure(
                error,
                error instanceof SpeechAnalysisError ? error.stage : 'aligning',
              ),
          }
        : undefined,
    ),
  )

  ipcMain.handle('speech-analysis:cancel', (event, input: unknown) =>
    toIpcResult(async (): Promise<TranscriptionCancellationResult> => {
      const request = parseCancelRequest(input)
      const found = await jobs.cancelAndSettleJob({
        kind: 'speech-analysis',
        ...request,
        senderId: event.sender.id,
      })
      return found ? 'cancelled' : 'not-found'
    }, diagnosticSink),
  )
}

function parseStartRequest(input: unknown): SpeechAnalysisJobRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = input as Partial<SpeechAnalysisJobRequest>
  if (candidate.scope !== undefined) {
    if (
      candidate.audioSourceId !== undefined ||
      typeof candidate.language !== 'string' ||
      !candidate.draft ||
      !candidate.scope ||
      typeof candidate.scope !== 'object' ||
      (candidate.scope.kind !== 'all' &&
        !(
          candidate.scope.kind === 'track' &&
          typeof candidate.scope.trackId === 'string' &&
          candidate.scope.trackId.length > 0
        )) ||
      (candidate.mode !== undefined &&
        candidate.mode !== 'missing' &&
        candidate.mode !== 'regenerate')
    )
      throw new PublicIpcError('invalid-request')
    const tasks =
      candidate.tasks === undefined ? undefined : SpeechTaskSelectionSchema.parse(candidate.tasks)
    const tracks = z.array(TrackSchema).parse(candidate.draft.tracks)
    return {
      ...precondition,
      jobId: requireJobId(candidate.jobId) as SpeechAnalysisJobId,
      scope:
        candidate.scope.kind === 'all'
          ? { kind: 'all' }
          : { kind: 'track', trackId: candidate.scope.trackId },
      language: candidate.language,
      draft: { ...candidate.draft, tracks },
      mode: candidate.mode,
      ...(tasks ? { tasks } : {}),
      ...(candidate.confirmSpeakerLabelReset === true ? { confirmSpeakerLabelReset: true } : {}),
    }
  }
  if (
    typeof candidate.audioSourceId !== 'string' ||
    typeof candidate.language !== 'string' ||
    !candidate.draft ||
    typeof candidate.draft !== 'object'
  )
    throw new PublicIpcError('invalid-request')
  return {
    ...precondition,
    jobId: requireJobId(candidate.jobId) as SpeechAnalysisJobId,
    audioSourceId: candidate.audioSourceId as never,
    language: candidate.language,
    draft: candidate.draft,
    ...(candidate.confirmSpeakerLabelReset === true ? { confirmSpeakerLabelReset: true } : {}),
  }
}

function parseCancelRequest(input: unknown): CancelSessionJobRequest<SpeechAnalysisJobId> {
  return {
    ...requireSessionPrecondition(input),
    jobId: requireJobId((input as { jobId?: unknown })?.jobId) as SpeechAnalysisJobId,
  }
}
