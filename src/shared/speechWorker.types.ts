import { z } from 'zod'
import { TranscriptUnitSchema } from './speech.types'

export const SpeechWorkerRequestSchema = z
  .object({
    protocolVersion: z.literal(1),
    jobId: z.string().min(1),
    audioPath: z.string().min(1),
    phase: z.enum(['alignment', 'diarization']).optional(),
    language: z.string().min(1).optional(),
    transcriptUnits: z.array(TranscriptUnitSchema).optional(),
    // Recognition timing bounds the acoustic search; it is never an edit boundary.
    alignmentSegments: z
      .array(
        z
          .object({
            text: z.string(),
            sourceStart: z.number().finite().nonnegative().optional(),
            sourceEnd: z.number().finite().nonnegative().optional(),
          })
          .strict()
          .refine(
            (segment) =>
              segment.sourceStart === undefined ||
              segment.sourceEnd === undefined ||
              segment.sourceStart <= segment.sourceEnd,
            'Invalid alignment search range',
          ),
      )
      .optional(),
    models: z
      .object({
        alignment: z.string().min(1).optional(),
        diarization: z.string().min(1).optional(),
      })
      .strict(),
    modelPaths: z.record(z.string(), z.string().min(1)).optional(),
    config: z
      .object({
        device: z.enum(['cpu', 'cuda', 'mps']).default('cpu'),
        speakerRecognitionEnabled: z.boolean().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message })
    if (
      request.phase !== 'diarization' &&
      (!request.language || !request.transcriptUnits || !request.models.alignment)
    )
      fail('Alignment requires language, transcript units and alignment model')
    if (
      request.phase === 'diarization' &&
      (request.language !== undefined ||
        request.transcriptUnits !== undefined ||
        request.alignmentSegments !== undefined ||
        request.models.alignment !== undefined)
    )
      fail('Diarization-only requests must omit alignment inputs')
    if (
      request.phase !== 'alignment' &&
      (request.phase === 'diarization' || request.config.speakerRecognitionEnabled !== false) &&
      !request.models.diarization
    )
      fail('Diarization model is required when speaker recognition is enabled')
  })

const envelope = { protocolVersion: z.literal(1), jobId: z.string().min(1) }
export const WorkerAlignmentUnitSchema = z
  .object({
    transcriptUnitIds: z.array(z.string().uuid()).min(1),
    sourceStart: z.number().finite().nonnegative(),
    sourceEnd: z.number().finite().nonnegative(),
    granularity: z.enum(['character', 'word', 'phrase', 'utterance']),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((unit) => unit.sourceStart < unit.sourceEnd, 'Invalid alignment range')

export const WorkerDiarizationTurnSchema = z
  .object({
    speakerLabel: z.string().min(1),
    sourceStart: z.number().finite().nonnegative(),
    sourceEnd: z.number().finite().nonnegative(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((turn) => turn.sourceStart < turn.sourceEnd, 'Invalid diarization range')

export const SpeechWorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('ready') }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal('progress'),
      stage: z.enum(['aligning', 'diarizing']),
      percent: z.number().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('result'),
      result: z
        .object({
          phase: z.enum(['alignment', 'diarization']).optional(),
          alignment: z
            .object({
              units: z.array(WorkerAlignmentUnitSchema),
              unalignedTranscriptUnitIds: z.array(z.string().uuid()),
              provenance: z.record(z.string(), z.unknown()),
            })
            .strict()
            .optional(),
          diarization: z
            .union([
              z.object({ status: z.literal('skipped-disabled') }).strict(),
              z
                .object({
                  status: z.literal('completed').optional(),
                  turns: z.array(WorkerDiarizationTurnSchema),
                  provenance: z.record(z.string(), z.unknown()),
                })
                .strict(),
            ])
            .optional(),
        })
        .strict()
        .superRefine((result, context) => {
          const valid =
            result.phase === 'alignment'
              ? Boolean(result.alignment) && result.diarization === undefined
              : result.phase === 'diarization'
                ? result.alignment === undefined &&
                  result.diarization?.status !== 'skipped-disabled' &&
                  Boolean(result.diarization)
                : Boolean(result.alignment && result.diarization)
          if (!valid)
            context.addIssue({ code: 'custom', message: 'Worker result does not match phase' })
        }),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('error'),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
])

export type SpeechWorkerRequest = z.infer<typeof SpeechWorkerRequestSchema>
export type SpeechWorkerResponse = z.infer<typeof SpeechWorkerResponseSchema>
export type SpeechWorkerResult = Extract<SpeechWorkerResponse, { type: 'result' }>['result']
