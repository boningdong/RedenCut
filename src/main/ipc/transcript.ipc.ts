import { ipcMain } from 'electron'
import type {
  CancelSessionJobRequest,
  SessionJobResult,
  TranscriptionJobRequest,
} from '../../shared/ipc.types'
import type { Transcript } from '../../shared/ProjectTypes'
import type {
  TranscriptionCancellationResult,
  TranscriptionJobId,
} from '../../shared/transcriber.types'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import type { WorkspaceController } from '../project/WorkspaceController'
import { TranscriptionCoordinator } from '../speech/transcriber/TranscriptionCoordinator'
import { whisperTranscriber } from '../speech/transcriber/whisper'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

type DiagnosticSink = (error: unknown) => void

export function registerTranscriptIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: DiagnosticSink = console.error,
): void {
  const coordinator = new TranscriptionCoordinator({
    async transcribe(path, options, signal, onProgress) {
      const result = await whisperTranscriber.transcribe(path, options, signal, onProgress)
      return {
        engine: result.provenance.engineId,
        model: result.provenance.modelId,
        speakers: {},
        words: result.evidence.flatMap((segment, segmentIndex) =>
          (segment.tokens ?? []).flatMap((token, tokenIndex) =>
            token.sourceStart === undefined || token.sourceEnd === undefined
              ? []
              : [
                  {
                    id: `raw-${segmentIndex}-${tokenIndex}`,
                    text: token.text.trim(),
                    start: token.sourceStart,
                    end: token.sourceEnd,
                    confidence: token.confidence,
                    muted: false,
                  },
                ],
          ),
        ),
      }
    },
  })
  const cancellationOutcomes = new Map<string, TranscriptionCancellationResult>()
  const cancellationWaiters = new Map<string, number>()

  ipcMain.handle('transcript:check-availability', () =>
    toIpcResult(() => whisperTranscriber.unavailableReason(), diagnosticSink),
  )
  ipcMain.handle('transcript:generate', (event, input: unknown) =>
    toIpcResult(async (): Promise<SessionJobResult<Transcript, TranscriptionJobId>> => {
      const request = transcriptionRequest(input)
      controller.assertCurrent(request)
      const identity = {
        kind: 'transcription' as const,
        ...request,
        senderId: event.sender.id,
      }
      const cancellationKey = transcriptionIdentityKey(identity)
      cancellationOutcomes.delete(cancellationKey)
      let operation!: Promise<SessionJobResult<Transcript, TranscriptionJobId>>
      const unregister = jobs.register(identity, () => {
        const resolveOriginal = controller.captureOriginalResolver(request)
        const execution = coordinator.start(identity, resolveOriginal, (progress) => {
          if (event.sender.isDestroyed()) return
          try {
            controller.assertCurrent(request)
          } catch {
            return
          }
          event.sender.send('transcript:progress', progress)
        })
        operation = execution.settled.then((result) => {
          controller.assertCurrent(request)
          return result
        })
        return {
          cancel: () => {
            cancellationOutcomes.set(cancellationKey, 'cancelled')
            void execution.cancel()
          },
          settled: operation,
        }
      })
      const cancelSenderJobs = () => {
        void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
      }
      event.sender.once('destroyed', cancelSenderJobs)
      try {
        return await operation
      } finally {
        event.sender.removeListener('destroyed', cancelSenderJobs)
        unregister()
        if (!cancellationWaiters.has(cancellationKey)) cancellationOutcomes.delete(cancellationKey)
      }
    }, diagnosticSink),
  )
  ipcMain.handle('transcript:cancel', (event, input: unknown) =>
    toIpcResult(async (): Promise<TranscriptionCancellationResult> => {
      const request = transcriptionCancelRequest(input)
      const identity = {
        kind: 'transcription' as const,
        ...request,
        senderId: event.sender.id,
      }
      const key = transcriptionIdentityKey(identity)
      cancellationWaiters.set(key, (cancellationWaiters.get(key) ?? 0) + 1)
      try {
        const found = await jobs.cancelAndSettleJob(identity)
        return found ? (cancellationOutcomes.get(key) ?? 'not-found') : 'not-found'
      } finally {
        const remaining = (cancellationWaiters.get(key) ?? 1) - 1
        if (remaining > 0) cancellationWaiters.set(key, remaining)
        else {
          cancellationWaiters.delete(key)
          cancellationOutcomes.delete(key)
        }
      }
    }, diagnosticSink),
  )
}

function transcriptionRequest(input: unknown): TranscriptionJobRequest {
  const precondition = requireSessionPrecondition(input)
  if (!input || typeof input !== 'object') throw new PublicIpcError('invalid-request')
  const candidate = input as Partial<TranscriptionJobRequest>
  if (typeof candidate.audioSourceId !== 'string') throw new PublicIpcError('invalid-request')
  return {
    ...precondition,
    jobId: requireJobId(candidate.jobId) as TranscriptionJobId,
    audioSourceId: candidate.audioSourceId,
    ...(typeof candidate.language === 'string' ? { language: candidate.language } : {}),
  }
}

function transcriptionCancelRequest(input: unknown): CancelSessionJobRequest<TranscriptionJobId> {
  return {
    ...requireSessionPrecondition(input),
    jobId: requireJobId((input as { jobId?: unknown })?.jobId) as TranscriptionJobId,
  }
}

function transcriptionIdentityKey(identity: {
  jobId: TranscriptionJobId
  senderId: number
  workspaceToken: TranscriptionJobRequest['workspaceToken']
  revision: number
}): string {
  return JSON.stringify([
    identity.jobId,
    identity.senderId,
    identity.workspaceToken,
    identity.revision,
  ])
}
