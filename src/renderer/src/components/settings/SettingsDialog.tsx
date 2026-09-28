import { useEffect, useState } from 'react'
import type { DiagnosticCollectionRequest } from '@shared/DiagnosticBundleTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { PreferencesDialog } from './PreferencesDialog'
import { DiagnosticsSettings } from './DiagnosticsSettings'
import { GeneralSettings } from './GeneralSettings'
import { ThemeSettings } from './ThemeSettings'
import { SpeechResourcesSettings } from './SpeechResourcesSettings'
import { Icon } from '../ui/Icon'
import { LocaleNotice } from '../LocaleNotice'
type SettingsTab = 'general' | 'theme' | 'resources' | 'diagnostics'
export function SettingsDialog({
  onClose,
  initialTab = 'general',
  diagnosticsRequest,
  autoCollect = false,
  navigationId = 0,
}: {
  onClose: () => void
  initialTab?: SettingsTab
  diagnosticsRequest?: DiagnosticCollectionRequest
  autoCollect?: boolean
  navigationId?: number
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  useEffect(() => setTab(initialTab), [initialTab, navigationId])
  return (
    <PreferencesDialog className="settings" label={t('settings.title')} onClose={onClose}>
      <div className="settings-layout">
        <nav className="settings-nav">
          <h3>{t('settings.title')}</h3>
          {(['general', 'theme', 'resources', 'diagnostics'] as const).map((id) => (
            <button key={id} data-value={id} aria-current={tab === id} onClick={() => setTab(id)}>
              <Icon
                name={
                  id === 'general'
                    ? 'globe'
                    : id === 'theme'
                      ? 'palette'
                      : id === 'diagnostics'
                        ? 'activity'
                        : 'wave'
                }
              />
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
          <div className={`settings-scroll${tab === 'diagnostics' ? ' diagnostics-scroll' : ''}`}>
            <LocaleNotice />
            {tab === 'general' ? (
              <GeneralSettings />
            ) : tab === 'theme' ? (
              <ThemeSettings />
            ) : tab === 'diagnostics' ? (
              <DiagnosticsSettings request={diagnosticsRequest} autoCollect={autoCollect} />
            ) : (
              <SpeechResourcesSettings />
            )}
          </div>
        </section>
      </div>
    </PreferencesDialog>
  )
}
