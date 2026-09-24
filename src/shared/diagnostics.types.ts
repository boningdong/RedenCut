import { z } from 'zod'

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
      event: z.literal('speech/alignment-started'),
      facts: z.object({ segmentCount: z.number().int().nonnegative() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('speech/stage-started'),
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
      event: z.literal('speech/stage-completed'),
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
      event: z.literal('operation/failed'),
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

export const DiagnosticReportSchema = z
  .object({
    reportVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    diagnosticIds: z.array(z.uuid()).min(1).max(20),
    partial: z.boolean(),
    environment: z
      .object({
        appVersion: z.string().max(64),
        platform: z.string().max(32),
        architecture: z.string().max(32),
      })
      .strict(),
    events: z.array(AppLogEventSchema).max(1000),
  })
  .strict()

export interface DiagnosticReportPreview {
  previewId: string
  content: string
  eventCount: number
  partial: boolean
  diagnosticIds: string[]
}

export type DiagnosticSaveResult = { status: 'saved' } | { status: 'cancelled' }
