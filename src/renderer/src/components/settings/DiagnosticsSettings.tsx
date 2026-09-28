import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { Button } from '../ui/Button'
import { DiagnosticCollectionPanel } from '../diagnostics/DiagnosticCollectionPanel'

export function DiagnosticsSettings() {
  const { t } = useTranslation()
  const [collecting, setCollecting] = useState(false)
  return collecting ? (
    <DiagnosticCollectionPanel request={{ kind: 'recent' }} />
  ) : (
    <>
      <p>{t('diagnostics.description')}</p>
      <Button size="sm" variant="primary" onClick={() => setCollecting(true)}>
        {t('diagnostics.collect')}
      </Button>
    </>
  )
}
