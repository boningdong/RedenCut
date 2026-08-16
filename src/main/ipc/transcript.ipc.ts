import { ipcMain } from 'electron'
import type { SessionJobResult, TranscriptionJobRequest } from '../../shared/ipc.types'
import type { Transcript } from '../../shared/project.types'
import type { SessionJobRegistry } from '../project/SessionJobRegistry'
import type { WorkspaceController } from '../project/WorkspaceController'
import { whisperTranscriber } from '../transcriber/whisper'
import { PublicIpcError, requireJobId, requireSessionPrecondition, toIpcResult } from './ipcResult'

type DiagnosticSink = (error: unknown) => void

export function registerTranscriptIpc(
  controller: WorkspaceController,
  jobs: SessionJobRegistry,
  diagnosticSink: DiagnosticSink = console.error,
): void {
  ipcMain.handle('transcript:check-availability', () =>
    toIpcResult(() => whisperTranscriber.unavailableReason(), diagnosticSink),
  )
  ipcMain.handle('transcript:generate', (event, input: unknown) =>
    toIpcResult(async (): Promise<SessionJobResult<Transcript>> => {
      const request = transcriptionRequest(input)
      controller.assertCurrent(request)
      const operation = (async () => {
        const path = await controller.resolveOriginal(request.audioSourceId)
        const value = await whisperTranscriber.transcribe(
          path,
          { language: request.language },
          (status) => {
            if (!event.sender.isDestroyed())
              event.sender.send('transcript:progress', { ...requestEnvelope(request), status })
          },
        )
        return { ...requestEnvelope(request), value }
      })()
      const unregister = jobs.register({
        kind: 'transcription',
        ...requestEnvelope(request),
        senderId: event.sender.id,
        cancel: () => {},
        settled: operation,
      })
      event.sender.once('destroyed', () => {
        void jobs.cancelAndSettleSender(event.sender.id).catch(diagnosticSink)
      })
      try {
        return await operation
      } finally {
        unregister()
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
    jobId: requireJobId(candidate.jobId),
    audioSourceId: candidate.audioSourceId,
    language: candidate.language,
  }
}

function requestEnvelope(request: TranscriptionJobRequest) {
  return {
    workspaceToken: request.workspaceToken,
    revision: request.revision,
    jobId: request.jobId,
  }
}
