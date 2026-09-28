import type { DiagnosticCollectionRequest } from '@shared/DiagnosticBundleTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { PreferencesDialog } from '../settings/PreferencesDialog'
import { Button } from '../ui/Button'
import { DiagnosticCollectionPanel } from './DiagnosticCollectionPanel'

export function DiagnosticReportDialog({
  request,
  onClose,
}: {
  request: DiagnosticCollectionRequest
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <PreferencesDialog label={t('diagnostics.title')} onClose={onClose}>
      <div
        className="settings-main"
        style={{ padding: 24, maxWidth: 760, maxHeight: '80vh', overflow: 'auto' }}
      >
        <h2>{t('diagnostics.title')}</h2>
        <DiagnosticCollectionPanel request={request} />
        <Button size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </PreferencesDialog>
  )
}
