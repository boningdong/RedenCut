import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { SpeechBatchProgress } from './SpeechBatchProgress'
import './transcript.css'

export function TranscriptStatusFooter({
  children,
  ...progress
}: ComponentProps<typeof SpeechBatchProgress> & { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="transcript-footer" aria-label={t('transcript.statusLabel')} role="region">
      <SpeechBatchProgress {...progress} />
      {children}
    </div>
  )
}
