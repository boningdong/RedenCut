import type { SpeechProgress, TranscriptionProgress } from '@shared/publicMessages'
import { useSpeechBatchStore } from '../../stores/speechBatch.store'
import { useTranslation } from '../../i18n/useTranslation'
import { publicMessage } from '../../i18n/messages'
import { SpeechProgressStatus } from './SpeechProgressStatus'

export function SpeechBatchProgress({
  isGenerating,
  status,
  onCancel,
}: {
  isGenerating: boolean
  status: SpeechProgress | TranscriptionProgress | null
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const progress = useSpeechBatchStore((state) => state.progress)
  const cancelled = useSpeechBatchStore((state) => state.cancelled)
  const summary = useSpeechBatchStore((state) => state.summary)
  return (
    <>
      {isGenerating && (
        <>
          {progress && (
            <div role="status">
              {t('transcript.batchSource', {
                phase: t(
                  progress.phase === 'text' ? 'transcript.batchText' : 'transcript.batchSpeakers',
                ),
                index: progress.sourceIndex,
                count: progress.sourceCount,
                name: progress.displayName,
              })}
            </div>
          )}
          <SpeechProgressStatus key={progress?.audioSourceId} status={status} onCancel={onCancel} />
        </>
      )}
      {cancelled && !summary && <div role="status">{t('transcript.batchStopped')}</div>}
      {summary && (
        <div role="status">
          {t(summary.cancelled ? 'transcript.batchCancelled' : 'transcript.batchComplete', {
            count: summary.sourceCount,
            completed: summary.completedCount,
            reused: summary.reusedCount,
            failed: summary.failures.length,
          })}
          {summary.failures.map((failure) => (
            <div key={`${failure.audioSourceId}:${failure.phase}`}>
              {failure.displayName}: {publicMessage(t, failure.error)}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
