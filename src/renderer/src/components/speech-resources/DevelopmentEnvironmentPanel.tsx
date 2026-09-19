import { Icon } from '../ui/Icon'
import type { DevelopmentCheck } from '@shared/developmentEnvironment.types'
import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useResourcesStore } from '../../stores/resources.store'
import './developmentEnvironment.css'
export function DevelopmentEnvironmentPanel() {
  const { t } = useTranslation()
  const { snapshot, pending, refresh } = useResourcesStore()
  const dev = snapshot?.development
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const [guide, setGuide] = useState<'tools' | 'python' | null>(null)
  if (!dev) return null
  const open = expanded ?? !dev.ready
  const row = (label: string, ready: boolean, key: DevelopmentCheck) => (
    <div className="dev-item">
      <span className="dev-item-label">
        <span>{label}</span>
        {key === 'libraries' && (
          <span className="dev-library-names">
            WhisperX · PyTorch · pyannote.audio · PyAV · TorchCodec
          </span>
        )}
        {dev.paths?.[key] && <code className="dev-path">{dev.paths[key]}</code>}
      </span>
      <span
        className={
          dev.checking?.includes(key) ? 'download-status' : `status ${ready ? 'ready' : 'pending'}`
        }
        role="status"
        aria-label={label}
      >
        <i className={dev.checking?.includes(key) ? 'loading-spinner' : 'status-dot'} />
        {t(
          dev.checking?.includes(key)
            ? 'settings.devChecking'
            : ready
              ? 'settings.ready'
              : 'settings.devMissing',
        )}
      </span>
    </div>
  )
  const actions = (group: 'tools' | 'python') => {
    const checks: DevelopmentCheck[] =
      group === 'tools' ? ['ffmpeg', 'ffprobe', 'whisper'] : ['python', 'libraries']
    const checking = dev.checking?.some((key) => checks.includes(key)) ?? false
    return (
      <div className="dev-block-footer">
        <button className="outline" onClick={() => setGuide(guide === group ? null : group)}>
          {t('settings.devGuide')}
        </button>
        <button
          className="recheck-action"
          aria-disabled={pending}
          onClick={() => {
            if (pending) return
            setExpanded(true)
            void refresh()
          }}
        >
          {checking ? <i className="loading-spinner" /> : <Icon name="refresh" />}
          {t(checking ? 'settings.devChecking' : 'settings.devValidate')}
        </button>
      </div>
    )
  }
  return (
    <section className="dev-env">
      <button className="dev-summary" aria-expanded={open} onClick={() => setExpanded(!open)}>
        <span className="cap-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="m7 9 3 3-3 3m6 0h4" />
          </svg>
        </span>
        <span className="dev-summary-copy">
          <span className="dev-summary-title">
            <b>{t('settings.devTitle')}</b>
            <span className="pill">{t('settings.devOnly')}</span>
            <span aria-hidden="true" className={`section-chevron ${open ? 'expanded' : ''}`}>
              <svg viewBox="0 0 16 16">
                <path d="m6 4 4 4-4 4" />
              </svg>
            </span>
          </span>
          {dev.runtimePath && <span className="dev-summary-path dev-path">{dev.runtimePath}</span>}
        </span>
        <span className={`status ${dev.ready ? 'ready' : 'pending'}`}>
          <i className={dev.checking?.length ? 'loading-spinner' : 'status-dot'} />
          {t(
            dev.checking?.length
              ? 'settings.devChecking'
              : dev.ready
                ? 'settings.ready'
                : 'settings.devRequired',
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="dev-grid">
            <section className="dev-block">
              <h3>{t('settings.devTools')}</h3>
              <p>{t('settings.devToolsHelp')}</p>
              {row('FFmpeg', dev.ffmpeg, 'ffmpeg')}
              {row('FFprobe', dev.ffprobe, 'ffprobe')}
              {row('whisper-cli', dev.whisper, 'whisper')}
              {actions('tools')}
              {guide === 'tools' && (
                <div className="dev-guide">
                  <p>{t('settings.devRunAtRoot')}</p>
                  <code>npm run runtime:setup</code>
                  <p>{t('settings.devToolReturn')}</p>
                </div>
              )}
            </section>
            <section className="dev-block">
              <h3>{t('settings.devPython')}</h3>
              <p>{t('settings.devPythonHelp')}</p>
              {row('Python 3.11', dev.python, 'python')}
              {row(t('settings.devLibraries'), dev.libraries, 'libraries')}
              {actions('python')}
              {guide === 'python' && (
                <div className="dev-guide">
                  <b>{t('settings.devSetup')}</b>
                  <p>{t('settings.devRunAtRoot')}</p>
                  <code>npm run runtime:setup</code>
                  <p>{t('settings.devSetupHelp')}</p>
                  <p>{t('settings.devReturn')}</p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  )
}
