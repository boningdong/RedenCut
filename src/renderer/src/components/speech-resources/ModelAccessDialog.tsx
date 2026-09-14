import { LocalHuggingFaceLoginPanel } from './LocalHuggingFaceLoginPanel'
import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useResourcesStore } from '../../stores/resources.store'
import { PreferencesDialog } from '../settings/PreferencesDialog'
import { Icon } from '../ui/Icon'
export function ModelAccessDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const store = useResourcesStore()
  const status = store.access.status
  const checking = status === 'checking'
  const failed =
    status === 'invalid-token' ||
    status === 'access-denied' ||
    status === 'network-error' ||
    status === 'storage-unavailable'
  return (
    <PreferencesDialog className="access-dialog" label={t('settings.authorize')} onClose={onClose}>
      <div className="modal-heading">
        <h2>{t('settings.authorize')}</h2>
        <button className="icon" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <div className="access-scroll">
        <p className="lead">{t('settings.accessHelp')}</p>
        <button className="subaction" onClick={() => void store.openConditions()}>
          {t('settings.conditions')} ↗
        </button>
        {store.snapshot?.development && (
          <>
            <LocalHuggingFaceLoginPanel />
            <hr className="auth-method-divider" />
          </>
        )}
        <section className="auth-method" aria-labelledby="token-method-heading">
          <h3 id="token-method-heading">{t('settings.enterToken')}</h3>
          <p className="muted">{t('settings.tokenSafety')}</p>
          <label>
            {t('settings.token')}
            <input
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              disabled={checking}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <div className="resource-actions">
            <button
              className="primary"
              disabled={checking || (!token.trim() && !store.access.hasToken)}
              onClick={() => {
                const submitted = token
                setToken('')
                void store.verify(submitted.trim() || undefined)
              }}
            >
              {checking ? (
                <>
                  <i className="loading-spinner" />
                  {t('settings.checking')}
                </>
              ) : (
                t('settings.verify')
              )}
            </button>
          </div>
        </section>
        {failed && (
          <p className="error-message" role="alert">
            {t(`settings.${status}`)}
          </p>
        )}
        {store.error && (
          <p className="error-message" role="alert">
            {t('settings.resourceError')}
          </p>
        )}
        {status === 'granted' && <p className="status ready">✓ {t('settings.authorized')}</p>}
        {status === 'granted' && <p>{t('settings.authorizedDownloadHelp')}</p>}
        <div className="resource-actions">
          {store.access.hasToken && (
            <button disabled={checking} onClick={() => void store.clearToken()}>
              {t('settings.forgetToken')}
            </button>
          )}
        </div>
      </div>
    </PreferencesDialog>
  )
}
