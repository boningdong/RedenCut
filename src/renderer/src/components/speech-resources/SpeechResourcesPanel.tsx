import { DevelopmentEnvironmentPanel } from './DevelopmentEnvironmentPanel'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useLocaleStore } from '../../stores/locale.store'
import { useResourcesStore } from '../../stores/resources.store'
import { resourcesBusy } from './resourcePresentation'
import { Icon } from '../ui/Icon'
import { TextEditingResources } from './TextEditingResources'
import { SpeakerRecognitionResources } from './SpeakerRecognitionResources'
export function SpeechResourcesPanel() {
  const { t } = useTranslation()
  const preferences = useLocaleStore()
  const store = useResourcesStore()
  const [textExpanded, setTextExpanded] = useState(true)
  useEffect(() => {
    void useResourcesStore.getState().hydrate()
  }, [])
  const audioReady =
    !store.snapshot?.development ||
    (store.snapshot.development.ffmpeg && store.snapshot.development.ffprobe)
  return (
    <>
      {store.error && (
        <p className="error-message" role="alert">
          {t('settings.resourceError')}
        </p>
      )}
      <div className="resource-group">
        <div className="resource-heading">
          <div className="cap-icon">
            <Icon name="wave" />
          </div>
          <div>
            <h3>{t('settings.editing')}</h3>
            <p>{t('settings.editingHelp')}</p>
          </div>
          <div className="spacer" />
          <span className={`status ${audioReady ? 'ready' : 'pending'}`}>
            <i className="status-dot" />
            {t(audioReady ? 'settings.ready' : 'settings.devRequired')}
          </span>
        </div>
      </div>
      <DevelopmentEnvironmentPanel />
      <div className="resource-group text-resource">
        <div className="resource-heading">
          <div className="cap-icon">
            <Icon name="text" />
          </div>
          <div className="resource-title">
            <div className="toggle-heading">
              <h3>
                <button
                  className="section-disclosure"
                  aria-expanded={textExpanded}
                  aria-controls="text-resource-details"
                  onClick={() => setTextExpanded(!textExpanded)}
                >
                  {t('settings.textEditing')}
                  <span
                    aria-hidden="true"
                    className={`section-chevron ${textExpanded ? 'expanded' : ''}`}
                  >
                    <svg viewBox="0 0 16 16">
                      <path d="m6 4 4 4-4 4" />
                    </svg>
                  </span>
                </button>
              </h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={t('settings.textEditing')}
                  checked={preferences.textEditingEnabled}
                  disabled={resourcesBusy(store.snapshot) || store.pending}
                  onChange={(event) =>
                    void preferences.setFeaturePreferences({
                      textEditingEnabled: event.target.checked,
                    })
                  }
                />
                <span />
              </label>
            </div>
            <p>{t('settings.textHelp')}</p>
          </div>
        </div>
        <div id="text-resource-details" hidden={!textExpanded}>
          {!store.snapshot ? (
            <p className="stage-description">{t('settings.loading')}</p>
          ) : (
            <div className="vertical-flow">
              <TextEditingResources />
              <SpeakerRecognitionResources />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
