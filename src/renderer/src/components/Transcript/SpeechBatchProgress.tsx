import type { SpeechProgress, TranscriptionProgress } from '@shared/publicMessages'
import { useSpeechBatchStore } from '../../stores/speechBatch.store'
import { useTranslation } from '../../i18n/useTranslation'
import { publicMessage } from '../../i18n/messages'
import { SpeechProgressStatus } from './SpeechProgressStatus'
import { TranscriptProgressDetails } from './TranscriptProgressDetails'
import { useState } from 'react'
import { DiagnosticReportDialog } from '../diagnostics/DiagnosticReportDialog'
import { Button } from '../ui/Button'

export function SpeechBatchProgress({
  isGenerating,
  status,
  textReady,
  needsTimingReview = false,
  onCancel,
  onOpenSettings,
}: {
  isGenerating: boolean
  status: SpeechProgress | TranscriptionProgress | null
  textReady?: boolean
  needsTimingReview?: boolean
  onCancel?: () => void
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  const progress = useSpeechBatchStore((state) => state.progress)
  const cancelled = useSpeechBatchStore((state) => state.cancelled)
  const summary = useSpeechBatchStore((state) => state.summary)
  const dismiss = useSpeechBatchStore((state) => state.dismissSummary)
  const [reportIds, setReportIds] = useState<string[] | null>(null)
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
    <>
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
          <TranscriptProgressDetails defaultExpanded={summary.failures.length > 0}>
            <p>
              {t(summary.cancelled ? 'transcript.batchCancelled' : 'transcript.batchComplete', {
                count: summary.sourceCount,
                completed: summary.completedCount,
                reused: summary.reusedCount,
                failed: summary.failures.length,
              })}
            </p>
            {needsTimingReview && !summary.cancelled && !cancelled && !summary.failures.length && (
              <div className="transcript-review-notice" role="note">
                {t('transcript.needsReview')} · {t('transcript.reviewHint')}
              </div>
            )}
            {summary.failures.map((failure) => (
              <div key={`${failure.audioSourceId}:${failure.phase}`}>
                {failure.displayName}: {publicMessage(t, failure.error)}
                {failure.error.diagnosticId && (
                  <>
                    <small style={{ overflowWrap: 'anywhere' }}>
                      {' '}
                      {t('diagnostics.ids')}: {failure.error.diagnosticId}
                    </small>
                    <Button size="sm" onClick={() => setReportIds([failure.error.diagnosticId!])}>
                      {t('diagnostics.export')}
                    </Button>
                  </>
                )}
                {failure.error.reason === 'speech-alignment-model' && onOpenSettings && (
                  <Button size="sm" onClick={onOpenSettings}>
                    {t('diagnostics.openSettings')}
                  </Button>
                )}
              </div>
            ))}
            {summary.failures.filter((failure) => failure.error.diagnosticId).length > 1 && (
              <Button
                size="sm"
                onClick={() =>
                  setReportIds(
                    summary.failures.flatMap((failure) =>
                      failure.error.diagnosticId ? [failure.error.diagnosticId] : [],
                    ),
                  )
                }
              >
                {t('diagnostics.exportAll')}
              </Button>
            )}
          </TranscriptProgressDetails>
        )}
      </div>
      {reportIds && (
        <DiagnosticReportDialog diagnosticIds={reportIds} onClose={() => setReportIds(null)} />
      )}
    </>
  )
}
