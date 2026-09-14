import { LanguageSelector } from '../LanguageSelector'
import { useTranslation } from '../../i18n/useTranslation'
export function GeneralSettings() {
  const { t } = useTranslation()
  return (
    <div className="setting-row">
      <div>
        <h3>{t('settings.language')}</h3>
        <p>{t('settings.languageHelp')}</p>
      </div>
      <LanguageSelector />
    </div>
  )
}
