import { useTranslation } from '../../i18n/useTranslation'
import { useLocaleStore } from '../../stores/locale.store'
import { useResourcesStore } from '../../stores/resources.store'
import { aggregateResource, resourcesBusy } from '../speech-resources/resourcePresentation'
import { SpeechResourcesPanel } from '../speech-resources/SpeechResourcesPanel'
import { Icon } from '../ui/Icon'
export function PreparationStep({
  onContinue,
  onSkip,
}: {
  onContinue: () => void
  onSkip: () => void
}) {
  const { t } = useTranslation()
  const prefs = useLocaleStore()
  const store = useResourcesStore()
  const runtimeReady = !store.snapshot?.development || store.snapshot.development.ready
  const audioReady =
    !store.snapshot?.development ||
    (store.snapshot.development.ffmpeg && store.snapshot.development.ffprobe)
  const complete =
    (!prefs.textEditingEnabled && audioReady) ||
    (runtimeReady &&
      store.snapshot?.baseReady &&
      (!prefs.speakerRecognitionEnabled ||
        aggregateResource(store.snapshot, 'diarization').status === 'ready'))
  return (
    <>
      <div className="row">
        <div className="steps">
          <span>✓ {t('settings.welcomeStep')}</span>
          <span className="line" />
          <span className="current">{t('settings.prepareStep')}</span>
          <span className="line" />
          <span>{t('settings.finishStep')}</span>
        </div>
        <div className="spacer" />
        <button className="icon" onClick={onSkip} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <h2>{t('settings.prepareTitle')}</h2>
      <p className="lead">{t('settings.prepareLead')}</p>
      <div className="setup-scroll">
        <SpeechResourcesPanel />
      </div>
      <div className="resource-actions">
        <button onClick={onSkip}>{t('settings.skip')}</button>
        <button
          className="primary"
          disabled={!complete || resourcesBusy(store.snapshot) || store.pending}
          onClick={onContinue}
        >
          {t('settings.continue')}
          <Icon name="arrow" />
        </button>
      </div>
    </>
  )
}
