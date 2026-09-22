import { useTranslation } from '../../i18n/useTranslation'
import type { TrackWaveformDisplay } from './UseTrackWaveformDisplays'

export function WaveformPreparationStatus({ display }: { display: TrackWaveformDisplay }) {
  const { t } = useTranslation()
  const { progress, failed } = display
  const percent =
    progress && progress.total > 0
      ? Math.floor(Math.max(0, Math.min(1, progress.completed / progress.total)) * 100)
      : undefined
  return (
    <span
      className="waveform-update-status"
      role="status"
      data-preparation-phase={progress?.phase ?? 'processing'}
    >
      {failed ? (
        t('waveform.failedWaveform')
      ) : (
        <>
          {t(
            progress?.phase === 'waveform'
              ? 'waveform.buildingWaveform'
              : 'waveform.processingAudio',
          )}
          {percent !== undefined && ` ${percent}%`}
        </>
      )}
    </span>
  )
}
