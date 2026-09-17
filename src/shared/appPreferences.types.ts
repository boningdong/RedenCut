import { z } from 'zod'
import type { Locale, LocalePreference } from './i18n/locale.types'

export const LocalePreferenceSchema = z.enum(['system', 'en', 'zh-CN'])
export const ThemeIdSchema = z.enum(['dark', 'light'])
export const OnboardingDispositionSchema = z.enum(['pending', 'completed', 'skipped'])
export type ThemeId = z.infer<typeof ThemeIdSchema>
export type OnboardingDisposition = z.infer<typeof OnboardingDispositionSchema>
export const FeaturePreferencesSchema = z
  .object({
    textEditingEnabled: z.boolean().optional(),
    speakerRecognitionEnabled: z.boolean().optional(),
  })
  .strict()
export type FeaturePreferences = z.infer<typeof FeaturePreferencesSchema>
export const StoredAppPreferencesSchema = z.object({
  version: z.literal(1),
  localePreference: LocalePreferenceSchema,
  themeId: ThemeIdSchema.optional(),
  textEditingEnabled: z.boolean().default(true),
  speakerRecognitionEnabled: z.boolean().default(true),
  onboardingDisposition: OnboardingDispositionSchema.default('pending'),
  whisperModelId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .catch('transcription-default')
    .default('transcription-default'),
})

export interface AppPreferencesSnapshot {
  preference: LocalePreference
  resolvedLocale: Locale
  revision: number
  warning: 'invalid-preferences' | null
  themeId: ThemeId
  themePreferenceSet: boolean
  textEditingEnabled: boolean
  speakerRecognitionEnabled: boolean
  onboardingDisposition: OnboardingDisposition
  whisperModelId: string
}
