import { useTranslation } from '../../i18n/useTranslation'
import { useLocaleStore } from '../../stores/locale.store'
import { themeRegistry } from '../../themes/themeRegistry'
export function ThemeSettings({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const theme = useLocaleStore((s) => s.themeId)
  const setTheme = useLocaleStore((s) => s.setTheme)
  return (
    <>
      <p className="muted" hidden={compact}>
        {t('settings.themeHelp')}
      </p>
      <div className={compact ? 'segmented' : 'theme-grid'}>
        {themeRegistry.map((entry) => (
          <button
            key={entry.id}
            className={compact ? '' : 'theme-card'}
            aria-pressed={theme === entry.id}
            aria-label={t(entry.labelKey)}
            onClick={() => void setTheme(entry.id)}
          >
            {!compact && (
              <div className={`mini ${entry.id}`} aria-hidden="true">
                <div className="mini-top" />
                <div className="mini-text" />
                <div className="mini-wave">
                  {Array.from({ length: 24 }, (_, i) => (
                    <i key={i} />
                  ))}
                </div>
              </div>
            )}
            <span className="theme-label">
              <span>{t(entry.labelKey)}</span>
              {!compact && theme === entry.id && <span>✓</span>}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
