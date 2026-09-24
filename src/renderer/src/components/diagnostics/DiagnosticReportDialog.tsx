import { useEffect, useState } from 'react'
import type { DiagnosticReportPreview } from '@shared/diagnostics.types'
import { useTranslation } from '../../i18n/useTranslation'
import { normalizePublicError, publicMessage } from '../../i18n/messages'
import type { PublicMessage } from '@shared/publicMessages'
import { PreferencesDialog } from '../settings/PreferencesDialog'
import { Button } from '../ui/Button'

export function DiagnosticReportDialog({
  diagnosticIds,
  onClose,
}: {
  diagnosticIds: string[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<DiagnosticReportPreview | null>(null)
  const [failure, setFailure] = useState<PublicMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const idsKey = diagnosticIds.join(',')
  useEffect(() => {
    let mounted = true
    void window.electronAPI.diagnostics.previewReport(idsKey.split(',')).then(
      (value) => {
        if (mounted) setPreview(value)
      },
      (error: unknown) => {
        if (mounted) setFailure(normalizePublicError(error))
      },
    )
    return () => {
      mounted = false
    }
  }, [idsKey])
  const save = async () => {
    if (!preview) return
    try {
      const result = await window.electronAPI.diagnostics.saveReport(preview.previewId)
      if (result.status === 'saved') {
        setSaved(true)
        setFailure(null)
      }
    } catch (error) {
      setFailure(normalizePublicError(error))
    }
  }
  return (
    <PreferencesDialog label={t('diagnostics.title')} onClose={onClose}>
      <div
        className="settings-main"
        style={{ padding: 24, maxWidth: 760, maxHeight: '80vh', overflow: 'auto' }}
      >
        <h2>{t('diagnostics.title')}</h2>
        <p>{t('diagnostics.excluded')}</p>
        {preview?.partial && <p role="note">{t('diagnostics.partial')}</p>}
        <p style={{ overflowWrap: 'anywhere' }}>
          {t('diagnostics.ids')}: {diagnosticIds.join(', ')}
        </p>
        {failure && <p role="alert">{publicMessage(t, failure)}</p>}
        {preview ? (
          <>
            <p>{t('diagnostics.eventCount', { count: preview.eventCount })}</p>
            <pre
              aria-label={t('diagnostics.preview')}
              style={{
                overflow: 'auto',
                maxHeight: 320,
                whiteSpace: 'pre-wrap',
                userSelect: 'text',
              }}
            >
              {preview.content}
            </pre>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Button size="sm" variant="primary" onClick={() => void save()}>
                {saved || failure?.reason === 'report-save-failed'
                  ? t('diagnostics.saveAgain')
                  : t('diagnostics.save')}
              </Button>
              {saved && (
                <Button
                  size="sm"
                  onClick={() =>
                    void window.electronAPI.diagnostics
                      .showSavedReport(preview.previewId)
                      .catch((error: unknown) => setFailure(normalizePublicError(error)))
                  }
                >
                  {t('diagnostics.showSaved')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void navigator.clipboard.writeText(diagnosticIds.join(', '))}
              >
                {t('diagnostics.copyId')}
              </Button>
            </div>
          </>
        ) : (
          !failure && <p>{t('diagnostics.loading')}</p>
        )}
        <Button size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </PreferencesDialog>
  )
}
