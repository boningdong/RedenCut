import { createTranslator } from '@shared/i18n/createTranslator'
import { useLocaleStore } from '../stores/locale.store'

const translators = {
  en: createTranslator('en').getFixedT('en'),
  'zh-CN': createTranslator('zh-CN').getFixedT('zh-CN'),
}

export function useTranslation() {
  const locale = useLocaleStore((state) => state.resolvedLocale)
  return { t: translators[locale], locale }
}
