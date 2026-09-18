import type { SpeechProgress, TranscriptionProgress } from '@shared/publicMessages'
import { useSpeechBatchStore } from '../../stores/speechBatch.store'
import { useTranslation } from '../../i18n/useTranslation'
import { publicMessage } from '../../i18n/messages'
import { SpeechProgressStatus } from './SpeechProgressStatus'
import { TranscriptProgressDetails } from './TranscriptProgressDetails'

export function SpeechBatchProgress({
  isGenerating,
  status,
  textReady,
  onCancel,
}: {
  isGenerating: boolean
  status: SpeechProgress | TranscriptionProgress | null
  textReady?: boolean
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const progress = useSpeechBatchStore((state) => state.progress)
  const cancelled = useSpeechBatchStore((state) => state.cancelled)
  const summary = useSpeechBatchStore((state) => state.summary)
  const dismiss = useSpeechBatchStore((state) => state.dismissSummary)
  if (isGenerating)
    return (
      <SpeechProgressStatus
        key={progress?.audioSourceId}
        status={status}
        progress={progress}
        textReady={textReady}
        onCancel={onCancel}
      />
    )
  if (!summary && !cancelled) return null
  return (
    <div role="status" className="transcript-progress transcript-progress-complete">
      <div className="transcript-progress-row">
        <span className="transcript-progress-phase">
          {t(
            summary?.cancelled || cancelled
              ? 'transcript.batchStopped'
              : summary?.failures.length
                ? 'transcript.analysisFailed'
                : 'transcript.analysisComplete',
          )}
        </span>
        <button
          className="transcript-status-action"
          aria-label={t('transcript.dismissAnalysis')}
          onClick={dismiss}
        >
          ×
        </button>
      </div>
      {summary && (
        <TranscriptProgressDetails>
          <p>
            {t(summary.cancelled ? 'transcript.batchCancelled' : 'transcript.batchComplete', {
              count: summary.sourceCount,
              completed: summary.completedCount,
              reused: summary.reusedCount,
              failed: summary.failures.length,
            })}
          </p>
          {summary.failures.map((failure) => (
            <div key={`${failure.audioSourceId}:${failure.phase}`}>
              {failure.displayName}: {publicMessage(t, failure.error)}
            </div>
          ))}
        </TranscriptProgressDetails>
      )}
    </div>
  )
}
