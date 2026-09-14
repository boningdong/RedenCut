import type { ResourcePreparation, ResourceState } from '@shared/resources.types'
import { useResourcesStore } from '../../stores/resources.store'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
export function ResourceDownloadAction({
  target,
  resources,
  disabled = false,
}: {
  target: ResourcePreparation
  resources: ResourceState[]
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const store = useResourcesStore()
  const busy = resources.some((r) => r.status === 'downloading' || r.status === 'verifying')
  const resumable = resources.some((r) => r.status === 'failed' || r.status === 'paused')
  if (resources.every((r) => r.status === 'ready')) return null
  return (
    <button
      className="download-action"
      disabled={!busy && (store.pending || disabled)}
      onClick={() => void (busy ? store.cancel() : store.prepare(target))}
    >
      {!busy && !resumable && <Icon name="download" />}
      {busy ? t('common.cancel') : resumable ? t('settings.resume') : t('settings.download')}
    </button>
  )
}
