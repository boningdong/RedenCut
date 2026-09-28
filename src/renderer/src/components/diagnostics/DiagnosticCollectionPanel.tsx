import { useEffect, useState } from 'react'
import type {
  DiagnosticCollectionRequest,
  DiagnosticReportPreview,
} from '@shared/DiagnosticBundleTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { normalizePublicError, publicMessage } from '../../i18n/messages'
import type { PublicMessage } from '@shared/publicMessages'
import { Button } from '../ui/Button'

export function DiagnosticCollectionPanel({ request }: { request: DiagnosticCollectionRequest }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<DiagnosticReportPreview | null>(null)
  const [failure, setFailure] = useState<PublicMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify(request)
  useEffect(() => {
    let mounted = true
    let id: string | undefined
    setPreview(null)
    setFailure(null)
    setSaved(false)
    void window.electronAPI.diagnostics
      .previewReport(JSON.parse(requestKey) as DiagnosticCollectionRequest)
      .then(
        (value) => {
          id = value.previewId
          if (mounted) setPreview(value)
          else void window.electronAPI.diagnostics.releaseReport(id).catch(() => {})
        },
        (error: unknown) => {
          if (mounted) setFailure(normalizePublicError(error))
        },
      )
    return () => {
      mounted = false
      if (id) void window.electronAPI.diagnostics.releaseReport(id).catch(() => {})
    }
  }, [requestKey, attempt])
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      setFailure(null)
    } catch (error) {
      setFailure(normalizePublicError(error))
    }
  }
  const save = async () => {
    if (!preview || saving) return
    setSaving(true)
    try {
      const result = await window.electronAPI.diagnostics.saveReport(preview.previewId)
      if (result.status === 'saved') {
        setSaved(true)
        setFailure(null)
      }
    } catch (error) {
      setFailure(normalizePublicError(error))
    } finally {
      setSaving(false)
    }
  }
  const warningKeys = {
    'history-missing': 'diagnostics.historyMissing',
    'logs-unavailable': 'diagnostics.logsUnavailable',
    'invalid-records': 'diagnostics.invalidRecords',
    'log-losses': 'diagnostics.logLosses',
    'incomplete-counters': 'diagnostics.incompleteCounters',
  } as const
  return (
    <div className="diagnostic-collection">
      <p>{t('diagnostics.description')}</p>
      <p className="muted">{t('diagnostics.privacy')}</p>
      {failure && <p role="alert">{publicMessage(t, failure)}</p>}
      {preview ? (
        <>
          <p>
            {preview.manifest.environment.appVersion} · {preview.manifest.environment.platform}{' '}
            {preview.manifest.environment.osVersion} · {preview.manifest.environment.architecture}
          </p>
          <p>{t('diagnostics.size', { count: Math.ceil(preview.totalBytes / 1024) })}</p>
          <p className="muted">
            {t('diagnostics.coverage')}
            {preview.manifest.coverage.from && (
              <>
                {' '}
                {preview.manifest.coverage.from} — {preview.manifest.coverage.to}
              </>
            )}
          </p>
          {preview.manifest.diagnosticIds.length > 0 && (
            <p>
              {t('diagnostics.ids')}: {preview.manifest.diagnosticIds.join(', ')}
            </p>
          )}
          <ul>
            {preview.manifest.files.map((file) => (
              <li key={file.path}>{file.path}</li>
            ))}
          </ul>
          {preview.manifest.warnings.map((warning) => (
            <p role="note" key={warning}>
              {t(warningKeys[warning])}
            </p>
          ))}
          <div className="diagnostic-actions">
            <Button
              size="sm"
              onClick={() =>
                void run(() => window.electronAPI.diagnostics.inspectReport(preview.previewId))
              }
            >
              {t('diagnostics.inspect')}
            </Button>
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving
                ? t('diagnostics.saving')
                : failure?.reason === 'report-save-failed'
                  ? t('diagnostics.saveAgain')
                  : t('diagnostics.save')}
            </Button>
            {saved && (
              <Button
                size="sm"
                onClick={() =>
                  void run(() => window.electronAPI.diagnostics.showSavedReport(preview.previewId))
                }
              >
                {t('diagnostics.showSaved')}
              </Button>
            )}
          </div>
        </>
      ) : (
        !failure && <p>{t('diagnostics.loading')}</p>
      )}
      {(preview || failure) && (
        <Button size="sm" disabled={saving} onClick={() => setAttempt((value) => value + 1)}>
          {t('diagnostics.collectAgain')}
        </Button>
      )}
    </div>
  )
}
