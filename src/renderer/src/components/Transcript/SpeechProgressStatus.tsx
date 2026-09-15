import { useEffect, useState } from 'react'
import type { SpeechProgress, TranscriptionProgress } from '@shared/publicMessages'
import { useTranslation } from '../../i18n/useTranslation'
import { progressMessage } from '../../i18n/messages'

interface SpeechProgressStatusProps {
  status: SpeechProgress | TranscriptionProgress | null
  onCancel?: () => void
}

/** Own the display clock here so transcript content does not render on timer ticks. */
export function SpeechProgressStatus(props: SpeechProgressStatusProps) {
  return <TimedSpeechProgressStatus key={props.status?.stage ?? 'preparing'} {...props} />
}

function TimedSpeechProgressStatus({ status, onCancel }: SpeechProgressStatusProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  const [localStartedAt] = useState(Date.now)
  const mainStartedAt = status && 'stageStartedAtMs' in status ? status.stageStartedAtMs : undefined
  const startedAt = mainStartedAt ?? localStartedAt
  const estimate =
    status && 'estimatedDurationMs' in status ? status.estimatedDurationMs : undefined
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const percent = status?.percent
  const overrun =
    mainStartedAt !== undefined && estimate !== undefined && now - mainStartedAt > estimate
  return (
    <div className="transcript-progress">
      <div role="status">
        {status && <div>{t('transcript.generating')}</div>}
        <span>{status ? progressMessage(t, status) : t('transcript.generating')}</span>
        {percent !== undefined && (
          <span
            role="progressbar"
            aria-label={status ? progressMessage(t, status) : t('transcript.generating')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            {' '}
            · {Math.round(percent)}%
          </span>
        )}
        {elapsed !== undefined && (
          <span style={{ marginLeft: '0.5em' }}>
            {t('transcript.elapsed', {
              time:
                elapsed < 60
                  ? t('transcript.seconds', { seconds: elapsed })
                  : t('transcript.minutesSeconds', {
                      minutes: Math.floor(elapsed / 60),
                      seconds: elapsed % 60,
                    }),
            })}
          </span>
        )}
        {estimate !== undefined && (
          <p>
            {t('transcript.stageEstimate', { minutes: Math.max(1, Math.round(estimate / 60000)) })}
          </p>
        )}
        {overrun && <p>{t('transcript.estimateOverrun')}</p>}
      </div>
      {onCancel && <button onClick={onCancel}>{t('common.cancel')}</button>}
    </div>
  )
}
