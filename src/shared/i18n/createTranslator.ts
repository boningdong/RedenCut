import { createInstance, type i18n } from 'i18next'

import type { Locale } from './locale.types'
import { englishResources } from './locales/en'
import { simplifiedChineseResources } from './locales/zh-CN'

export function createTranslator(locale: Locale): i18n {
  const translator = createInstance()

  void translator.init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
    defaultNS: 'translation',
    resources: {
      en: { translation: structuredClone(englishResources) },
      'zh-CN': { translation: structuredClone(simplifiedChineseResources) },
    },
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  })

  return translator
}
