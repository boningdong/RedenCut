import { z } from 'zod'

const StemTrackIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Source selections must contain unique track IDs',
  )
export const MixLinkSchema = z.object({ stemTrackIds: StemTrackIdsSchema }).strict()
export const SourceOverrideSchema = z
  .object({
    id: z.string().min(1),
    sourceStart: z.number().finite().nonnegative(),
    sourceEnd: z.number().finite().nonnegative(),
    stemTrackIds: StemTrackIdsSchema,
  })
  .strict()
  .refine(
    (range) => range.sourceEnd > range.sourceStart,
    'Source override must have positive duration',
  )
