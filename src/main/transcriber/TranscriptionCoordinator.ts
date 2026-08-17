import type {
  SessionJobResult,
  TranscriptProgressEvent,
  TranscriptionJobRequest,
} from '../../shared/ipc.types'
import type { AudioSourceId, Transcript } from '../../shared/project.types'
import type { TranscriptionJobId } from '../../shared/transcriber.types'
import type { SessionJobExecution } from '../project/SessionJobRegistry'

interface TranscriptionEngine {
  transcribe(
    audioFilePath: string,
    options: { language?: string },
    signal: AbortSignal,
    onProgress?: (status: string) => void,
  ): Promise<Transcript>
}

export interface TranscriptionIdentity extends TranscriptionJobRequest {
  senderId: number
}

export interface TranscriptionExecution extends SessionJobExecution {
  settled: Promise<SessionJobResult<Transcript, TranscriptionJobId>>
}

interface ActiveTranscription {
  identity: TranscriptionIdentity
  controller: AbortController
  settled: Promise<SessionJobResult<Transcript, TranscriptionJobId>>
}

export class TranscriptionCoordinator {
  private readonly activeBySender = new Map<number, ActiveTranscription>()

  constructor(private readonly transcriber: TranscriptionEngine) {}

  start(
    identity: TranscriptionIdentity,
    resolveOriginal: (audioSourceId: AudioSourceId) => Promise<string>,
    onProgress: (progress: TranscriptProgressEvent) => void,
  ): TranscriptionExecution {
    const previous = this.activeBySender.get(identity.senderId)
    const controller = new AbortController()
    let resolveSettled!: (value: SessionJobResult<Transcript, TranscriptionJobId>) => void
    let rejectSettled!: (reason?: unknown) => void
    const settled = new Promise<SessionJobResult<Transcript, TranscriptionJobId>>(
      (resolve, reject) => {
        resolveSettled = resolve
        rejectSettled = reject
      },
    )
    const active: ActiveTranscription = { identity, controller, settled }
    this.activeBySender.set(identity.senderId, active)

    void this.run(active, previous, resolveOriginal, onProgress).then(resolveSettled, rejectSettled)

    return {
      cancel: () => controller.abort(),
      settled,
    }
  }

  private async run(
    active: ActiveTranscription,
    previous: ActiveTranscription | undefined,
    resolveOriginal: (audioSourceId: AudioSourceId) => Promise<string>,
    onProgress: (progress: TranscriptProgressEvent) => void,
  ): Promise<SessionJobResult<Transcript, TranscriptionJobId>> {
    const { identity, controller } = active
    try {
      if (previous) {
        previous.controller.abort()
        try {
          await previous.settled
        } catch (error) {
          if (!isAbortError(error)) throw error
        }
      }
      throwIfAborted(controller.signal)
      const audioFilePath = await resolveOriginal(identity.audioSourceId)
      throwIfAborted(controller.signal)
      const value = await this.transcriber.transcribe(
        audioFilePath,
        { language: identity.language },
        controller.signal,
        (status) => {
          if (!controller.signal.aborted && this.activeBySender.get(identity.senderId) === active)
            onProgress({ ...envelope(identity), status })
        },
      )
      throwIfAborted(controller.signal)
      if (this.activeBySender.get(identity.senderId) !== active) throw abortError()
      return { ...envelope(identity), value }
    } finally {
      if (this.activeBySender.get(identity.senderId) === active)
        this.activeBySender.delete(identity.senderId)
    }
  }
}

function envelope(identity: TranscriptionIdentity) {
  return {
    jobId: identity.jobId,
    workspaceToken: identity.workspaceToken,
    revision: identity.revision,
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function abortError(): DOMException {
  return new DOMException('Transcription cancelled', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
