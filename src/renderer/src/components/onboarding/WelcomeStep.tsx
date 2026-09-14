import { useTranslation } from '../../i18n/useTranslation'
import { LanguageSelector } from '../LanguageSelector'
import { ThemeSettings } from '../settings/ThemeSettings'
import { Icon } from '../ui/Icon'
export function WelcomeStep({
  onContinue,
  onSkip,
}: {
  onContinue: () => void
  onSkip: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="welcome-layout">
      <aside className="welcome-art">
        <div className="brand">RedenCut</div>
        <div className="art-stack">
          <div className="art-clip">
            <small>00:12 · BONING</small>
            <p>{t('settings.art1')}</p>
          </div>
          <div className="art-clip">
            <small>00:18 · ZHOU</small>
            <p>{t('settings.art2')}</p>
          </div>
        </div>
        <p className="muted">
          <Icon name="wave" />
          <br />
          {t('settings.local')}
        </p>
      </aside>
      <section className="welcome-content">
        <div className="row">
          <div className="spacer" />
          <button className="icon" onClick={onSkip} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </div>
        <h1>{t('settings.welcome')}</h1>
        <p className="lead">{t('settings.welcomeLead')}</p>
        <div className="welcome-controls">
          <div className="compact-field">
            <label>{t('settings.language')}</label>
            <LanguageSelector />
          </div>
          <div className="compact-field">
            <label>{t('settings.theme')}</label>
            <ThemeSettings compact />
          </div>
        </div>
        <div className="welcome-footer">
          <button className="textbutton" onClick={onSkip}>
            {t('settings.later')}
          </button>
          <button className="primary" onClick={onContinue}>
            {t('settings.continue')}
            <Icon name="arrow" />
          </button>
        </div>
      </section>
    </div>
  )
}
