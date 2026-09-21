import { useLocaleStore } from '../../stores/locale.store'
import { useResourcesStore } from '../../stores/resources.store'
import { useTranslation } from '../../i18n/useTranslation'
import { aggregateResource, resourcesBusy } from './resourcePresentation'
export function SpeakerRecognitionResources() {
  const { t } = useTranslation()
  const preferences = useLocaleStore()
  const store = useResourcesStore()
  const row = aggregateResource(store.snapshot, 'diarization')
  const enabled = preferences.textEditingEnabled && preferences.speakerRecognitionEnabled
  const available = row.status === 'ready'
  return (
    <section className={`flow-stage ${available ? 'stage-complete' : 'stage-locked'}`}>
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
            disabled={
              resourcesBusy(store.snapshot) ||
              store.pending ||
              !preferences.textEditingEnabled ||
              (!available && !enabled)
            }
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
            : !available
              ? store.snapshot?.development
                ? 'settings.speakerSetupRequired'
                : 'settings.speakerRepairRequired'
              : !preferences.speakerRecognitionEnabled
                ? 'settings.speakerDisabled'
                : 'settings.speakerManagedReady',
        )}
      </p>
    </section>
  )
}
