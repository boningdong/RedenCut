import { useEffect, useState } from 'react'
import type { SpeechProgress, TranscriptionProgress } from '@shared/publicMessages'
import type { SpeechBatchProgress } from '@shared/speechBatch.types'
import { useTranslation } from '../../i18n/useTranslation'
import { progressMessage } from '../../i18n/messages'
import { TranscriptProgressDetails } from './TranscriptProgressDetails'

interface SpeechProgressStatusProps {
  status: SpeechProgress | TranscriptionProgress | null
  progress?: SpeechBatchProgress | null
  textReady?: boolean
  onCancel?: () => void
}

/** Own the display clock here so transcript content does not render on timer ticks. */
export function SpeechProgressStatus(props: SpeechProgressStatusProps) {
  return <TimedSpeechProgressStatus key={props.status?.stage ?? 'preparing'} {...props} />
}

function TimedSpeechProgressStatus({
  status,
  progress,
  textReady,
  onCancel,
}: SpeechProgressStatusProps) {
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
  const phase = progress
    ? t(progress.phase === 'text' ? 'transcript.batchText' : 'transcript.batchSpeakers')
    : status
      ? progressMessage(t, status)
      : t('transcript.generating')
  return (
    <div className="transcript-progress" role="status">
      <div className="transcript-progress-row">
        <span className="transcript-progress-phase">
          {progress
            ? t('transcript.batchPosition', {
                phase,
                index: progress.sourceIndex,
                count: progress.sourceCount,
              })
            : phase}
        </span>
        <span className="transcript-progress-meta">
          {textReady && <span>{t('transcript.textReady')} · </span>}
          <span>
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
        </span>
        <span
          className="transcript-progress-meter"
          role="progressbar"
          aria-label={phase}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          data-indeterminate={percent === undefined || undefined}
        >
          <span className="transcript-progress-track" aria-hidden="true">
            <span
              className="transcript-progress-fill"
              style={{
                width: percent === undefined ? '32%' : `${Math.max(0, Math.min(100, percent))}%`,
              }}
            />
          </span>
          {percent !== undefined && (
            <span className="transcript-progress-percent">{Math.round(percent)}%</span>
          )}
        </span>
        {onCancel && (
          <button className="transcript-status-action" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
      </div>
      {(progress || estimate !== undefined) && (
        <TranscriptProgressDetails>
          {progress && <div className="transcript-progress-filename">{progress.displayName}</div>}
          {estimate !== undefined && (
            <p>
              {t('transcript.stageEstimate', {
                minutes: Math.max(1, Math.round(estimate / 60000)),
              })}
            </p>
          )}
        </TranscriptProgressDetails>
      )}
      {overrun && <p className="transcript-progress-meta">{t('transcript.estimateOverrun')}</p>}
    </div>
  )
}
