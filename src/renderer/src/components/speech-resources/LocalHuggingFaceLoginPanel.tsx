import { Icon } from '../ui/Icon'
import { useEffect, useRef, useState } from 'react'
import type { LocalModelLoginSnapshot } from '@shared/modelAccess.types'
import { useTranslation } from '../../i18n/useTranslation'
import { useResourcesStore } from '../../stores/resources.store'
export function LocalHuggingFaceLoginPanel() {
  const { t } = useTranslation()
  const store = useResourcesStore()
  const [status, setStatus] = useState<LocalModelLoginSnapshot['status'] | 'checking'>('checking')
  const request = useRef({ id: 0 })
  const detect = async () => {
    const id = ++request.current.id
    setStatus('checking')
    try {
      const result = await window.electronAPI.modelAccessLocal()
      if (id === request.current.id) setStatus(result.status)
    } catch {
      if (id === request.current.id) setStatus('unavailable')
    }
  }
  useEffect(() => {
    const lifecycle = request.current
    void detect()
    return () => {
      lifecycle.id++
    }
  }, [])
  const working = status === 'checking' || store.access.status === 'checking'
  return (
    <section className="auth-method" aria-labelledby="local-login-heading">
      <div className="row">
        <h3 id="local-login-heading">{t('settings.localLogin')}</h3>
        <span className="pill">{t('settings.devOnly')}</span>
      </div>
      <p className="muted">{t('settings.localLoginHelp')}</p>
      <p className={`status ${status === 'found' ? 'ready' : 'pending'}`} role="status">
        <i className={status === 'checking' ? 'loading-spinner' : 'status-dot'} />
        {t(`settings.localLogin-${status}`)}
      </p>
      {status !== 'found' && status !== 'checking' && (
        <p className="muted">
          {t('settings.localLoginCommand')} <code>hf auth login</code>
        </p>
      )}
      <div className="resource-actions">
        <button className="recheck-action" disabled={working} onClick={() => void detect()}>
          {status === 'checking' ? <i className="loading-spinner" /> : <Icon name="refresh" />}
          {t('settings.localLoginDetect')}
        </button>
        <button
          className="primary"
          disabled={working || status !== 'found'}
          onClick={() => void store.verifyLocal()}
        >
          {store.access.status === 'checking' && <i className="loading-spinner" />}
          {t('settings.localLoginUse')}
        </button>
      </div>
    </section>
  )
}
