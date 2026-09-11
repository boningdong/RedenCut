import { useTranslation } from '../i18n/useTranslation'
import { useLocaleStore } from '../stores/locale.store'
import { Button } from './ui/Button'

export function LocaleNotice() {
  const { t } = useTranslation()
  const error = useLocaleStore((state) => state.error)
  const warning = useLocaleStore((state) => state.warning)
  const hydrate = useLocaleStore((state) => state.hydrate)
  if (!error && !warning) return null
  return (
    <div className="locale-notice" role="alert">
      <span>
        {error?.reason === 'save-preferences'
          ? t('errors.savePreferences')
          : error?.reason === 'load-preferences'
            ? t('errors.loadPreferences')
            : t('errors.invalidPreferences')}
      </span>
      {error?.reason === 'load-preferences' && (
        <Button size="sm" variant="ghost" onClick={() => void hydrate()}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
