import { z } from 'zod'
import { AudioSourceIdSchema } from './source.types'
import { AnalysisRevisionIdSchema, SpeakerIdSchema } from './speech.types'

export const RenameSpeakerRequestSchema = z
  .object({
    workspaceToken: z.string().min(1),
    revision: z.number().int().positive(),
    audioSourceId: AudioSourceIdSchema,
    analysisRevisionId: AnalysisRevisionIdSchema,
    speakerId: SpeakerIdSchema,
    displayName: z.string().trim().min(1).max(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict()
export type RenameSpeakerRequest = z.infer<typeof RenameSpeakerRequestSchema>
