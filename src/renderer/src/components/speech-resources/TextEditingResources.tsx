import { useLocaleStore } from '../../stores/locale.store'
import { useResourcesStore } from '../../stores/resources.store'
import { useTranslation } from '../../i18n/useTranslation'
import { aggregateResource, resourcesBusy } from './resourcePresentation'
import { ModelResourceRow } from './ModelResourceRow'
import { ResourceDownloadAction } from './ResourceDownloadAction'
export function TextEditingResources() {
  const { t } = useTranslation()
  const enabled = useLocaleStore((s) => s.textEditingEnabled)
  const snapshot = useResourcesStore((s) => s.snapshot)
  const environmentMissing = !!snapshot?.development && !snapshot.development.ready
  const transcription = aggregateResource(snapshot, 'transcription')
  const alignment = aggregateResource(snapshot, 'alignment')
  return (
    <section
      className={`flow-stage ${!enabled || environmentMissing ? 'stage-locked' : snapshot?.baseReady ? 'stage-complete' : 'stage-current'}`}
    >
      <div className="flow-heading">
        <span className="stage-marker">1</span>
        <h3>{t('settings.core')}</h3>
        <ResourceDownloadAction
          target="base"
          resources={[transcription, alignment]}
          disabled={!enabled || environmentMissing || resourcesBusy(snapshot)}
        />
        {snapshot?.baseReady && <span className="status ready">{t('settings.ready')}</span>}
      </div>
      <p className="stage-description">
        {t(environmentMissing ? 'settings.devModelsBlocked' : 'settings.coreHelp')}
      </p>
      <div className="model-pair">
        <ModelResourceRow
          title={t('settings.transcription')}
          engine="Whisper"
          resource={transcription}
        />
        <ModelResourceRow
          title={t('settings.alignment')}
          engine="Alignment · 中文 / English"
          resource={alignment}
        />
      </div>
    </section>
  )
}
