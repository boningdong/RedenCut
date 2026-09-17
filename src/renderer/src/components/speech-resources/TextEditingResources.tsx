import { modelRuntimeReady } from '@shared/ModelRuntimeRequirements'
import { WhisperModelSelector } from './WhisperModelSelector'
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
  const whisperRuntimeMissing = !modelRuntimeReady(snapshot?.development, 'transcription')
  const transcription = aggregateResource(snapshot, 'transcription')
  const selected = snapshot?.whisperModels?.find((m) => m.id === snapshot.selectedWhisperModelId)
  const modelName = selected ? t(`settings.whisperModels.${selected.variant}`) : 'Small'
  const alignment = aggregateResource(snapshot, 'alignment')
  return (
    <section
      className={`flow-stage ${!enabled || environmentMissing ? 'stage-locked' : snapshot?.baseReady ? 'stage-complete' : 'stage-current'}`}
    >
      <div className="flow-heading">
        <span className="stage-marker">1</span>
        <h3>{t('settings.core')}</h3>
        {snapshot?.baseReady && <span className="status ready">{t('settings.ready')}</span>}
      </div>
      <p className="stage-description">
        {t(environmentMissing ? 'settings.devModelsBlocked' : 'settings.coreHelp')}
      </p>
      <div className="model-pair">
        <ModelResourceRow
          title={t('settings.transcription')}
          engine="Whisper"
          selection={<WhisperModelSelector disabled={!enabled || resourcesBusy(snapshot)} />}
          description={selected ? t(`settings.whisperHelp.${selected.variant}`) : undefined}
          hint={
            enabled && whisperRuntimeMissing && transcription.status !== 'ready'
              ? t('settings.whisperRuntimeRequired')
              : undefined
          }
          action={
            <ResourceDownloadAction
              target={{
                kind: 'model',
                modelId:
                  snapshot?.selectedWhisperModelId ??
                  snapshot?.resources.find((r) => r.capability === 'transcription')?.id ??
                  transcription.id,
              }}
              resources={[transcription]}
              disabled={!enabled || whisperRuntimeMissing || resourcesBusy(snapshot)}
              label={t('settings.downloadWhisper', { model: modelName })}
            />
          }
          resource={transcription}
        />
        <ModelResourceRow
          title={t('settings.alignment')}
          engine="Alignment · 中文 / English"
          action={
            <ResourceDownloadAction
              target="alignment"
              resources={[alignment]}
              disabled={!enabled || environmentMissing || resourcesBusy(snapshot)}
            />
          }
          resource={alignment}
        />
      </div>
    </section>
  )
}
