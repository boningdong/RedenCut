import { Icon } from '../ui/Icon'
import { useTranslation } from '../../i18n/useTranslation'
import { SpeechResourcesPanel } from '../speech-resources/SpeechResourcesPanel'
import { useResourcesStore } from '../../stores/resources.store'
export function SpeechResourcesSettings() {
  const { t } = useTranslation()
  const { pending, refresh } = useResourcesStore()
  return (
    <>
      <p className="muted">{t('settings.resourceHelp')}</p>
      <SpeechResourcesPanel />
      <div className="resource-actions">
        <button className="recheck-action" disabled={pending} onClick={() => void refresh()}>
          {pending ? <i className="loading-spinner" /> : <Icon name="refresh" />}
          {t(pending ? 'settings.devChecking' : 'settings.recheck')}
        </button>
      </div>
    </>
  )
}
