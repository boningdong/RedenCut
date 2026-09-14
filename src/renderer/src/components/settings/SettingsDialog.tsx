import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { PreferencesDialog } from './PreferencesDialog'
import { GeneralSettings } from './GeneralSettings'
import { ThemeSettings } from './ThemeSettings'
import { SpeechResourcesSettings } from './SpeechResourcesSettings'
import { Icon } from '../ui/Icon'
import { LocaleNotice } from '../LocaleNotice'
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'general' | 'theme' | 'resources'>('general')
  return (
    <PreferencesDialog className="settings" label={t('settings.title')} onClose={onClose}>
      <div className="settings-layout">
        <nav className="settings-nav">
          <h3>{t('settings.title')}</h3>
          {(['general', 'theme', 'resources'] as const).map((id) => (
            <button key={id} data-value={id} aria-current={tab === id} onClick={() => setTab(id)}>
              <Icon name={id === 'general' ? 'globe' : id === 'theme' ? 'palette' : 'wave'} />
              {t(`settings.${id}`)}
            </button>
          ))}
          <div className="spacer" />
          <small className="muted">RedenCut</small>
        </nav>
        <section className="settings-main">
          <div className="modal-heading">
            <h2>{t(`settings.${tab}`)}</h2>
            <button className="icon" onClick={onClose} aria-label={t('common.close')}>
              <Icon name="close" />
            </button>
          </div>
          <div className="settings-scroll">
            <LocaleNotice />
            {tab === 'general' ? (
              <GeneralSettings />
            ) : tab === 'theme' ? (
              <ThemeSettings />
            ) : (
              <SpeechResourcesSettings />
            )}
          </div>
        </section>
      </div>
    </PreferencesDialog>
  )
}
