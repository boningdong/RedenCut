import { useState } from 'react'
import { useLocaleStore } from '../../stores/locale.store'
import { useResourcesStore } from '../../stores/resources.store'
import { useTranslation } from '../../i18n/useTranslation'
import { aggregateResource, resourcesBusy } from './resourcePresentation'
import { ModelResourceRow } from './ModelResourceRow'
import { ResourceDownloadAction } from './ResourceDownloadAction'
import { ModelAccessDialog } from './ModelAccessDialog'
export function SpeakerRecognitionResources() {
  const { t } = useTranslation()
  const preferences = useLocaleStore()
  const store = useResourcesStore()
  const [authorize, setAuthorize] = useState(false)
  const row = aggregateResource(store.snapshot, 'diarization')
  const enabled = preferences.textEditingEnabled && preferences.speakerRecognitionEnabled
  const unlocked =
    enabled &&
    store.snapshot?.baseReady &&
    (!store.snapshot.development || store.snapshot.development.ready)
  const granted = store.access.status === 'granted'
  const busy = resourcesBusy(store.snapshot)
  return (
    <section
      className={`flow-stage ${!unlocked ? 'stage-locked' : row.status === 'ready' ? 'stage-complete' : 'stage-current'}`}
    >
      <div className="flow-heading">
        <span className="stage-marker">2</span>
        <h3>{t('settings.speaker')}</h3>
        <span className="pill">{t('settings.optional')}</span>
        <label className="toggle">
          <input
            type="checkbox"
            role="switch"
            aria-label={t('settings.speaker')}
            checked={enabled}
            disabled={busy || store.pending || !preferences.textEditingEnabled}
            onChange={(event) =>
              void preferences.setFeaturePreferences({
                speakerRecognitionEnabled: event.target.checked,
              })
            }
          />
          <span />
        </label>
      </div>
      <p className="stage-description">
        {t(
          !preferences.textEditingEnabled
            ? 'settings.textDisabled'
            : !preferences.speakerRecognitionEnabled
              ? 'settings.speakerDisabled'
              : !store.snapshot?.baseReady
                ? 'settings.lockedHelp'
                : 'settings.speakerHelp',
        )}
      </p>
      {enabled && (
        <div className={`model-pair ${!unlocked ? 'locked-models' : ''}`}>
          <ModelResourceRow
            title={t('settings.authorize')}
            engine="Hugging Face"
            locked={!unlocked ? t('settings.locked') : undefined}
            action={
              unlocked ? (
                <button
                  className={granted ? 'status ready' : 'download-action'}
                  disabled={busy}
                  onClick={() => setAuthorize(true)}
                >
                  {granted ? <>✓ {t('settings.authorized')}</> : <>{t('settings.authorize')} ↗</>}
                </button>
              ) : undefined
            }
          />
          <ModelResourceRow
            title={t('settings.speakerModel')}
            engine="pyannote"
            resource={row}
            locked={
              !unlocked || (!granted && row.status !== 'ready')
                ? t('settings.authorizeFirst')
                : undefined
            }
            action={
              unlocked && granted ? (
                <ResourceDownloadAction target="diarization" resources={[row]} disabled={busy} />
              ) : undefined
            }
          />
        </div>
      )}
      {authorize && <ModelAccessDialog onClose={() => setAuthorize(false)} />}
    </section>
  )
}
