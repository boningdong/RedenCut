import { useResourcesStore } from '../../stores/resources.store'
import type { ResourceState } from '@shared/resources.types'
import type { ReactNode } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { resourcePercent } from './resourcePresentation'
export function ModelResourceRow({
  title,
  engine,
  resource,
  action,
  locked,
}: {
  title: string
  engine: string
  resource?: ResourceState
  action?: ReactNode
  locked?: string
}) {
  const { t } = useTranslation()
  const development = useResourcesStore((s) => s.snapshot?.development)
  const percent = resource ? resourcePercent(resource) : null
  const status = resource?.status ?? 'missing'
  const failure = resource?.status === 'failed' ? resource.error : undefined
  const failureKey =
    failure === 'runtime-unavailable'
      ? 'runtimeUnavailable'
      : failure === 'integrity-failed'
        ? 'integrityFailed'
        : failure === 'access-denied'
          ? 'resourceAccessDenied'
          : failure === 'download-failed'
            ? 'downloadFailed'
            : undefined
  const statusLabel = failureKey ? t(`settings.${failureKey}`) : t(`settings.${status}`)
  const moving = status === 'downloading' || status === 'verifying'
  return (
    <div className="model-row">
      <div className="row">
        <span>{title}</span>
        <span className="model-engine">{engine}</span>
        <div className="spacer" />
        {action}
        {locked ? (
          <span className="status pending">
            <i className="status-dot" />
            {locked}
          </span>
        ) : resource || !action ? (
          <span
            className={
              moving
                ? 'download-status'
                : `status ${status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : 'pending'}`
            }
            role="status"
            aria-label={`${title}: ${statusLabel}`}
          >
            <i className={moving ? 'loading-spinner' : 'status-dot'} aria-hidden="true" />
            <span>
              {moving && percent !== null
                ? `${status === 'verifying' ? t('settings.verifying') + ' · ' : ''}${percent}%`
                : statusLabel}
            </span>
          </span>
        ) : null}
      </div>
      {failureKey && (
        <p className="error-message" role="alert">
          {t(
            failureKey === 'runtimeUnavailable' && development
              ? 'settings.devRuntimeError'
              : `settings.${failureKey}Help`,
          )}
        </p>
      )}
    </div>
  )
}
