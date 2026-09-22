import { z } from 'zod'

// targetLufs and loudnessRange are persisted legacy settings; Auto Level now
// preserves the incoming program reference instead of imposing a LUFS target.
const NormalizeParamsSchema = z
  .object({
    targetLufs: z.number().finite().min(-70).max(-5).default(-16),
    truePeakDbtp: z.number().finite().min(-9).max(0).default(-1.5),
    loudnessRange: z.number().finite().min(1).max(50).default(7),
  })
  .strict()
export type NormalizeParams = z.infer<typeof NormalizeParamsSchema>
export const NORMALIZE_DEFAULTS: NormalizeParams = {
  targetLufs: -16,
  truePeakDbtp: -1.5,
  loudnessRange: 7,
}
export const NormalizeEffectSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('normalize'),
    enabled: z.boolean().default(true),
    params: NormalizeParamsSchema.prefault({}),
  })
  .strict()
export type NormalizeEffect = z.infer<typeof NormalizeEffectSchema>

/** Settings are validated at project and IPC boundaries; inactive legacy effects remain roundtrippable. */
export function getNormalizeEffect(track: {
  effects: readonly { type: string; enabled: boolean; params: unknown; id: string }[]
}): NormalizeEffect | undefined {
  const effect = track.effects.find((entry) => entry.type === 'normalize' && entry.enabled)
  return effect ? NormalizeEffectSchema.parse(effect) : undefined
}

export function trackGain(track: { gainDb?: number }): number {
  return 10 ** ((track.gainDb ?? 0) / 20)
}
