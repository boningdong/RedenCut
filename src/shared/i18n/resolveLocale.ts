import type { Locale, LocalePreference } from './locale.types'

export function resolveLocale(
  preference: LocalePreference,
  systemLanguages: readonly string[],
): Locale {
  if (preference !== 'system') return preference

  for (const systemLanguage of systemLanguages) {
    const language = systemLanguage.toLowerCase()

    if (language === 'en' || language.startsWith('en-')) return 'en'
    if (
      language === 'zh' ||
      language === 'zh-cn' ||
      language.startsWith('zh-cn-') ||
      language === 'zh-sg' ||
      language.startsWith('zh-sg-') ||
      language === 'zh-hans' ||
      language.startsWith('zh-hans-')
    ) {
      return 'zh-CN'
    }
  }

  return 'en'
}
