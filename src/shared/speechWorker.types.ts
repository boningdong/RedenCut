import { z } from 'zod'
import { TranscriptUnitSchema } from './speech.types'

export const SpeechWorkerRequestSchema = z.object({
  protocolVersion: z.literal(1),
  jobId: z.string().min(1),
  audioPath: z.string().min(1),
  language: z.string().min(1),
  transcriptUnits: z.array(TranscriptUnitSchema),
  models: z.object({ alignment: z.string().min(1), diarization: z.string().min(1) }).strict(),
  config: z.object({ device: z.enum(['cpu', 'cuda', 'mps']).default('cpu') }).strict(),
}).strict()

const envelope = { protocolVersion: z.literal(1), jobId: z.string().min(1) }
export const WorkerAlignmentUnitSchema = z.object({
  transcriptUnitIds: z.array(z.string().uuid()).min(1),
  sourceStart: z.number().finite().nonnegative(),
  sourceEnd: z.number().finite().nonnegative(),
  granularity: z.enum(['character', 'word', 'phrase', 'utterance']),
  confidence: z.number().min(0).max(1).optional(),
}).strict().refine((unit) => unit.sourceStart < unit.sourceEnd, 'Invalid alignment range')

export const WorkerDiarizationTurnSchema = z.object({
  speakerLabel: z.string().min(1),
  sourceStart: z.number().finite().nonnegative(),
  sourceEnd: z.number().finite().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
}).strict().refine((turn) => turn.sourceStart < turn.sourceEnd, 'Invalid diarization range')

export const SpeechWorkerResponseSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('ready') }).strict(),
  z.object({ ...envelope, type: z.literal('progress'),
    stage: z.enum(['aligning', 'diarizing']), percent: z.number().min(0).max(100).optional() }).strict(),
  z.object({ ...envelope, type: z.literal('result'), result: z.object({
    alignment: z.object({ units: z.array(WorkerAlignmentUnitSchema), unalignedTranscriptUnitIds: z.array(z.string().uuid()), provenance: z.record(z.string(), z.unknown()) }).strict(),
    diarization: z.object({ turns: z.array(WorkerDiarizationTurnSchema), provenance: z.record(z.string(), z.unknown()) }).strict(),
  }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('error'), code: z.string().min(1), message: z.string().min(1) }).strict(),
])

export type SpeechWorkerRequest = z.infer<typeof SpeechWorkerRequestSchema>
export type SpeechWorkerResponse = z.infer<typeof SpeechWorkerResponseSchema>
export type SpeechWorkerResult = Extract<SpeechWorkerResponse, { type: 'result' }>['result']
