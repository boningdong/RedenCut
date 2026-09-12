import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
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
import { whisperTranscriber } from '../transcriber/whisper'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

export function registerSpeechAnalysisIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: (error: unknown) => void = console.error,
): void {
  const workerRoot = process.env.REDENCUT_SPEECH_WORKER_ROOT ?? join(process.cwd(), 'speech-worker')
  const python =
    process.env.REDENCUT_SPEECH_WORKER_PYTHON ?? join(workerRoot, '.venv', 'bin', 'python')
  const manifest = process.env.REDENCUT_SPEECH_MANIFEST ?? join(workerRoot, 'models.json')
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
      const whisperReason = await whisperTranscriber.unavailableReason()
      if (whisperReason) return whisperReason
      if (!existsSync(python)) return { reason: 'speech-worker-missing' as const }
      if (!existsSync(manifest) || !existsSync(modelCache))
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
