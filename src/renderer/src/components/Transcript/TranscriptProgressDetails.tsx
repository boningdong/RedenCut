import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'

export function TranscriptProgressDetails({
  children,
  defaultExpanded = false,
}: {
  children: ReactNode
  defaultExpanded?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const id = useId()
  return (
    <>
      <button
        type="button"
        className="transcript-status-action transcript-details-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        {t('transcript.analysisDetails')}
        <Icon name="chevron" size={14} />
      </button>
      <div id={id} className="transcript-progress-details" hidden={!expanded}>
        {children}
      </div>
    </>
  )
}
