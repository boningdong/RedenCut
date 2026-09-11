import { z } from 'zod'
import type { Locale, LocalePreference } from './i18n/locale.types'

export const LocalePreferenceSchema = z.enum(['system', 'en', 'zh-CN'])

export const StoredAppPreferencesSchema = z.object({
  version: z.literal(1),
  localePreference: LocalePreferenceSchema,
})

export interface AppPreferencesSnapshot {
  preference: LocalePreference
  resolvedLocale: Locale
  revision: number
  warning: 'invalid-preferences' | null
}
