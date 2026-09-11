import type { LocalePreference } from '@shared/i18n/locale.types'
import { useTranslation } from '../i18n/useTranslation'
import { useLocaleStore } from '../stores/locale.store'

export function LanguageSelector() {
  const { t } = useTranslation()
  const preference = useLocaleStore((state) => state.preference)
  const pending = useLocaleStore((state) => state.pending)
  const setLocale = useLocaleStore((state) => state.setLocale)
  return (
    <label className="language-selector">
      <span>{t('app.languageLabel')}</span>
      <select
        value={preference}
        aria-busy={pending}
        onChange={(event) => void setLocale(event.target.value as LocalePreference)}
        onKeyDown={(event) => {
          // Native selection, letter search and dismissal must not edit the timeline.
          if (!event.metaKey && !event.ctrlKey) event.stopPropagation()
        }}
      >
        <option value="system">{t('app.followSystem')}</option>
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </label>
  )
}
