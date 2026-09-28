import { z } from 'zod'

export const AppLogEvents = {
  SpeechAlignmentStarted: 'speech/alignment-started',
  SpeechStageStarted: 'speech/stage-started',
  SpeechStageCompleted: 'speech/stage-completed',
  OperationFailed: 'operation/failed',
} as const

export const AppDiagnosticCodes = {
  OperationFailed: 'app/operation-failed',
  SpeechWorkerExit: 'speech/worker-exit',
  SpeechWorkerProtocol: 'speech/worker-protocol',
} as const

const base = {
  schemaVersion: z.literal(1),
  time: z.iso.datetime(),
  level: z.enum(['info', 'warn', 'error']),
  operationId: z.string().min(1).max(128),
  diagnosticId: z.uuid().optional(),
}

export const AppLogEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      ...base,
      event: z.literal(AppLogEvents.SpeechAlignmentStarted),
      facts: z.object({ segmentCount: z.number().int().nonnegative() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal(AppLogEvents.SpeechStageStarted),
      facts: z
        .object({
          stage: z.enum([
            'preparing-audio',
            'transcribing',
            'aligning',
            'diarizing',
            'attributing-speakers',
            'validating',
            'publishing',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal(AppLogEvents.SpeechStageCompleted),
      facts: z
        .object({
          stage: z.enum([
            'preparing-audio',
            'transcribing',
            'aligning',
            'diarizing',
            'attributing-speakers',
            'validating',
            'publishing',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal(AppLogEvents.OperationFailed),
      facts: z
        .object({
          code: z
            .string()
            .regex(/^[a-z-]+\/[a-z-]+$/)
            .max(96),
          stage: z
            .string()
            .regex(/^[a-z-]+$/)
            .max(48),
        })
        .strict(),
    })
    .strict(),
])

export type AppLogEvent = z.infer<typeof AppLogEventSchema>

export type { DiagnosticReportPreview } from './DiagnosticBundleTypes'
export type DiagnosticSaveResult = { status: 'saved' } | { status: 'cancelled' }
