import type { TFunction } from 'i18next'
import type { PublicMessage, PublicReason } from '@shared/publicMessages'
const reasonKeys = {
  'runtime-unavailable': 'errors.runtime-unavailable',
  'operation-failed': 'errors.operation-failed',
  'stale-session': 'errors.stale-session',
  cancelled: 'errors.cancelled',
  'invalid-request': 'errors.invalid-request',
  'save-failed': 'errors.save-failed',
  'candidate-invalid': 'errors.candidate-invalid',
  'job-settlement-failed': 'errors.job-settlement-failed',
  'switch-unacknowledged': 'errors.switch-unacknowledged',
  'whisper-missing': 'errors.whisper-missing',
  'whisper-model-missing': 'errors.whisper-model-missing',
  'speech-worker-missing': 'errors.speech-worker-missing',
  'speech-language-unsupported': 'errors.speech-language-unsupported',
  'speech-models-missing': 'errors.speech-models-missing',
  'workspace-invalid': 'errors.workspace-invalid',
  'workspace-version': 'errors.workspace-version',
  'workspace-recovered': 'errors.workspace-recovered',
  'workspace-load': 'errors.workspace-load',
  'workspace-save': 'errors.workspace-save',
  'speaker-name': 'errors.speaker-name',
  'speaker-color': 'errors.speaker-color',
  'speaker-color-used': 'errors.speaker-color-used',
  'speaker-color-reserved': 'errors.speaker-color-reserved',
  'speech-preparing-audio': 'errors.speech-preparing-audio',
  'speech-transcribing': 'errors.speech-transcribing',
  'speech-aligning': 'errors.speech-aligning',
  'speech-diarizing': 'errors.speech-diarizing',
  'speech-attributing-speakers': 'errors.speech-attributing-speakers',
  'speech-validating': 'errors.speech-validating',
  'speech-publishing': 'errors.speech-publishing',
  'speech-alignment-input': 'errors.speech-alignment-input',
  'speech-alignment-window': 'errors.speech-alignment-window',
  'speech-alignment-model': 'errors.speech-alignment-model',
  'speech-worker-exit': 'errors.speech-worker-exit',
  'report-save-failed': 'errors.report-save-failed',
} as const satisfies Record<PublicReason, string>
/** Whitelist known reasons; never preserve arbitrary Error.message or other private fields. */
export function normalizePublicError(error: unknown): PublicMessage {
  if (error && typeof error === 'object') {
    const candidate = error as {
      reason?: unknown
      code?: unknown
      failureKind?: unknown
      diagnosticId?: unknown
    }
    const reason = candidate.reason ?? candidate.code
    if (typeof reason === 'string' && Object.prototype.hasOwnProperty.call(reasonKeys, reason))
      return {
        reason: reason as PublicReason,
        ...(typeof candidate.diagnosticId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          candidate.diagnosticId,
        )
          ? { diagnosticId: candidate.diagnosticId }
          : {}),
        ...(reason.startsWith('speech-') &&
        (candidate.failureKind === 'startup' ||
          candidate.failureKind === 'process-exit' ||
          candidate.failureKind === 'protocol')
          ? { failureKind: candidate.failureKind }
          : {}),
      }
  }
  return { reason: 'operation-failed' }
}
const failureKindKeys = {
  startup: 'errors.speechStartup',
  'process-exit': 'errors.speechProcessExit',
  protocol: 'errors.speechProtocol',
} as const
export function publicMessage(t: TFunction, message: PublicMessage): string {
  const stageMessage = t(reasonKeys[message.reason])
  return message.failureKind
    ? t('errors.speechFailureDetail', {
        stageMessage,
        detail: t(failureKindKeys[message.failureKind]),
      })
    : stageMessage
}

const progressKeys = {
  selected: 'progress.selected',
  validating: 'progress.validating',
  copying: 'progress.copying',
  referencing: 'progress.referencing',
  'building-cache': 'progress.building-cache',
  publishing: 'progress.publishing',
  ready: 'progress.ready',
  preparing: 'progress.preparing',
  'preparing-audio': 'progress.preparing',
  'detecting-silence': 'progress.detecting-silence',
  'starting-transcription': 'progress.starting-transcription',
  'parsing-transcript': 'progress.parsing-transcript',
  transcribing: 'progress.transcribing',
  aligning: 'progress.aligning',
  diarizing: 'progress.diarizing',
  'attributing-speakers': 'progress.attributing-speakers',
} as const
export function progressMessage(
  t: TFunction,
  progress: { stage: keyof typeof progressKeys },
): string {
  return t(progressKeys[progress.stage])
}
