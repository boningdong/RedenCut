import type { ResourceManager } from '../resources/ResourceManager'
import type { AppPreferencesStore } from '../preferences/AppPreferencesStore'
import type { AppRuntimeLocator } from '../runtime/AppRuntimeLocator'
import { TranscriberUnavailableError } from '../speech/transcriber/TranscriberUnavailableError'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
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
import { SpeechAnalysisCoordinator } from '../speech/SpeechAnalysisCoordinator'
import { withSpeechAudio } from '../speech/prepareSpeechAudio'
import { SpeechAnalysisError, type SpeechFailureStage } from '../speech/SpeechAnalysisError'
import { SpeechWorkerClient } from '../speech/SpeechWorkerClient'
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
): void {
  const workerRoot = services
    ? dirname(services.manifestPath)
    : (process.env.REDENCUT_SPEECH_WORKER_ROOT ?? join(process.cwd(), 'speech-worker'))
  let managedWhisper: string | null = null
  if (services) whisperTranscriber.setModelResolver(() => managedWhisper)
  const python = services
    ? (() => {
        try {
          return services.runtime.getSpeechPythonPath()
        } catch {
          return ''
        }
      })()
    : (process.env.REDENCUT_SPEECH_WORKER_PYTHON ?? join(workerRoot, '.venv', 'bin', 'python'))
  const manifest =
    services?.manifestPath ??
    process.env.REDENCUT_SPEECH_MANIFEST ??
    join(workerRoot, 'models.json')
  const modelCache =
    process.env.REDENCUT_SPEECH_MODEL_CACHE ??
    join(homedir(), 'Library', 'Caches', 'RedenCut', 'speech-models')
  const worker = new SpeechWorkerClient(python, ['-m', 'redencut_speech_worker'], {
    cwd: workerRoot,
    env: {
      ...process.env,
      PYTHONPATH: join(workerRoot, 'src'),
      REDENCUT_SPEECH_MANIFEST: manifest,
      REDENCUT_SPEECH_MODEL_CACHE: modelCache,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
    },
  })
  const coordinator = new SpeechAnalysisCoordinator(whisperTranscriber, worker, randomUUID)

  ipcMain.handle('speech-analysis:check-availability', () =>
    toIpcResult(async () => {
      if (services) {
        const preferences = await services.preferences.read()
        if (!preferences.textEditingEnabled) return { reason: 'speech-models-missing' as const }
        const paths = await services.resources.getModelPaths()
        const transcription = services.resources.models.find(
          (model) => model.capability === 'transcription',
        )!
        managedWhisper = paths[transcription.id]
          ? join(paths[transcription.id], transcription.files[0].path)
          : null
        if (
          !paths['alignment-zh'] ||
          !paths['alignment-en'] ||
          (preferences.speakerRecognitionEnabled && !paths['diarization-default'])
        )
          return { reason: 'speech-models-missing' as const }
      }
      const whisperReason = await whisperTranscriber.unavailableReason()
      if (whisperReason) return whisperReason
      if (!existsSync(python)) return { reason: 'speech-worker-missing' as const }
      if (!existsSync(manifest) || (!services && !existsSync(modelCache)))
        return { reason: 'speech-models-missing' as const }
      return null
    }, diagnosticSink),
  )

  ipcMain.handle('speech-analysis:start', (event, input: unknown) =>
    toIpcResult(
      async (): Promise<
        SessionJobResult<Awaited<ReturnType<WorkspaceController['describe']>>, SpeechAnalysisJobId>
      > => {
        const request = parseStartRequest(input)
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
        if (services && !python) throw new TranscriberUnavailableError('speech-worker-missing')
        const preferences = services ? await services.preferences.read() : undefined
        const modelPaths = services ? await services.resources.getModelPaths() : undefined
        let transcriptionModel: string | undefined
        if (services && modelPaths) {
          const model = services.resources.models.find(
            (model) => model.capability === 'transcription',
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
        const resolvePcm = controller.captureSpeechPcmResolver(request)
        const identity = {
          kind: 'speech-analysis' as const,
          jobId: request.jobId,
          senderId: event.sender.id,
          workspaceToken: request.workspaceToken,
          revision: request.revision,
        }
        const abortController = new AbortController()
        const settled = (async () => {
          let stage: SpeechFailureStage = 'preparing-audio'
          try {
            const pcm = await resolvePcm(request.audioSourceId)
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
                (progress) => {
                  stage = progress.stage
                  if (!event.sender.isDestroyed())
                    event.sender.send('speech-analysis:progress', { ...identity, ...progress })
                },
              ),
            )
            abortController.signal.throwIfAborted()
            stage = 'publishing'
            if (!event.sender.isDestroyed())
              event.sender.send('speech-analysis:progress', { ...identity, stage: 'publishing' })
            const session = await controller.commitSpeechAnalysis(request, artifact, request.draft)
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
        })()
        const unregister = jobs.register(identity, () => ({
          cancel: () => abortController.abort(),
          settled,
        }))
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
      },
      diagnosticSink,
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
