import { useMediaRecoveryStore } from '../../stores/MediaRecoveryStore'
import { usePreparationProgressStore } from '../../stores/PreparationProgressStore'
import { useTranslation } from '../../i18n/useTranslation'
import { Button } from '../ui/Button'
import './AudioPreparationProgress.css'

export function AudioPreparationProgress({ onCancel }: { onCancel: () => void }) {
  const active = usePreparationProgressStore((state) => state.active)
  const importing = usePreparationProgressStore((state) => state.importing)
  const recovering = useMediaRecoveryStore((state) => state.snapshot?.status === 'active')
  const { t } = useTranslation()
  if (!active?.visible) return null
  const waitingForMedia =
    active.kind === 'open' && recovering && active.stage !== 'preparing-editor'
  const percent =
    !waitingForMedia && active.progress.kind === 'determinate'
      ? Math.round(Math.max(0, Math.min(1, active.progress.fraction)) * 100)
      : undefined
  const phase = t(`preparation.stages.${waitingForMedia ? 'waiting-for-media' : active.stage}`)
  const title = t(active.kind === 'open' ? 'preparation.opening' : 'preparation.importing')
  return (
    <div className="audio-preparation">
      <div className="audio-preparation-spinner-column" aria-hidden="true">
        <span className="audio-preparation-spinner" />
      </div>
      <strong className="audio-preparation-title">{title}</strong>
      <span className="audio-preparation-phase" role="status">
        {phase}
      </span>
      <span className="audio-preparation-file" title={active.displayName}>
        {active.displayName}
      </span>
      {active.source && (
        <span className="audio-preparation-count">
          {t('preparation.sourceCount', { index: active.source.index, total: active.source.total })}
        </span>
      )}
      {percent !== undefined && <span className="audio-preparation-percent">{percent}%</span>}
      {importing && (
        <Button size="sm" variant="ghost" disabled={!importing.canCancel} onClick={onCancel}>
          {t(active.kind === 'open' ? 'preparation.cancelImport' : 'common.cancel')}
        </Button>
      )}
      <div
        className="audio-preparation-meter"
        role="progressbar"
        aria-label={`${title}: ${phase}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-indeterminate={percent === undefined}
      >
        <span style={percent === undefined ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  )
}
