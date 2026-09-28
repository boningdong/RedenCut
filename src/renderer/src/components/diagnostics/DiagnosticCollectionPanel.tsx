import { useEffect, useState } from 'react'
import type {
  DiagnosticCollectionRequest,
  DiagnosticReportPreview,
} from '@shared/DiagnosticBundleTypes'
import { useTranslation } from '../../i18n/useTranslation'
import { normalizePublicError, publicMessage } from '../../i18n/messages'
import type { PublicMessage } from '@shared/publicMessages'
import { Icon } from '../ui/Icon'

export function DiagnosticCollectionPanel({
  request,
  autoCollect = false,
}: {
  request: DiagnosticCollectionRequest
  autoCollect?: boolean
}) {
  const { t, locale } = useTranslation()
  const [preview, setPreview] = useState<DiagnosticReportPreview | null>(null)
  const [failure, setFailure] = useState<PublicMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify(request)
  const started = autoCollect || attempt > 0
  useEffect(() => {
    let mounted = true
    let id: string | undefined
    setPreview(null)
    setFailure(null)
    setSaved(false)
    if (!started) return
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
  }, [requestKey, attempt, started])
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
    // Counter completeness is diagnostic metadata, not an actionable user warning.
    'incomplete-counters': null,
  } as const
  const environment = preview?.manifest.environment
  const platform =
    environment?.platform === 'darwin'
      ? 'macOS'
      : environment?.platform === 'win32'
        ? 'Windows'
        : environment?.platform
  const architecture =
    environment?.platform === 'darwin' && environment.architecture === 'arm64'
      ? 'Apple silicon'
      : environment?.architecture
  const formatTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    )
  return (
    <div className="diagnostic-collection">
      <p className="diagnostic-intro">{t('diagnostics.description')}</p>
      {!started && (
        <section className="diagnostic-included">
          <h3>{t('diagnostics.included')}</h3>
          <div>
            <Icon name="text" />
            {t('diagnostics.events')}
          </div>
          <div>
            <Icon name="file" />
            {t('diagnostics.logs')}
          </div>
          <div>
            <Icon name="monitor" />
            {t('diagnostics.system')}
          </div>
        </section>
      )}
      {preview && (
        <section className="diagnostic-result">
          <div className="diagnostic-result-heading">
            <Icon name="circleCheck" />
            <strong>{t('diagnostics.ready')}</strong>
            <span>
              {t('diagnostics.summary', {
                files: preview.manifest.files.length + 1,
                size: Math.ceil(preview.totalBytes / 1024),
              })}
            </span>
          </div>
          <dl className="diagnostic-metadata">
            <dt>{t('diagnostics.history')}</dt>
            <dd>
              {preview.manifest.coverage.from && preview.manifest.coverage.to
                ? `${formatTime(preview.manifest.coverage.from)} – ${formatTime(preview.manifest.coverage.to)} · ${t('diagnostics.localTime')}`
                : t('diagnostics.coverage')}
            </dd>
            <dt>{t('diagnostics.application')}</dt>
            <dd>
              {environment?.appVersion} · {platform} · {architecture}
            </dd>
            {preview.manifest.diagnosticIds.length > 0 && (
              <>
                <dt>{t('diagnostics.ids')}</dt>
                <dd>{preview.manifest.diagnosticIds.join(', ')}</dd>
              </>
            )}
          </dl>
          <details className="diagnostic-files">
            <summary>{t('diagnostics.files')}</summary>
            {preview.manifest.files.map((file) => (
              <div className="diagnostic-file" key={file.path}>
                <span>{t(file.kind === 'events' ? 'diagnostics.events' : 'diagnostics.logs')}</span>
                <span>{file.path}</span>
              </div>
            ))}
            <div className="diagnostic-file">
              <span>{t('diagnostics.system')}</span>
              <span>manifest.json</span>
            </div>
          </details>
        </section>
      )}
      {started && !preview && !failure && <p role="status">{t('diagnostics.loading')}</p>}
      <div className="diagnostic-privacy">
        <p>{t('diagnostics.excluded')}</p>
        <details>
          <summary>{t('diagnostics.beforeSharing')}</summary>
          <p>{t('diagnostics.privacy')}</p>
        </details>
      </div>
      {failure && (
        <p className="diagnostic-error" role="alert">
          {publicMessage(t, failure)}
        </p>
      )}
      {preview?.manifest.warnings.map((warning) => {
        const key = warningKeys[warning]
        return key ? (
          <p className="diagnostic-warning" role="note" key={warning}>
            {t(key)}
          </p>
        ) : null
      })}
      {saved && (
        <div className="diagnostic-saved" role="status">
          <span>{t('diagnostics.saved')}</span>
          <button
            className="diagnostic-saved-link"
            disabled={saving}
            onClick={() =>
              void run(() => window.electronAPI.diagnostics.showSavedReport(preview!.previewId))
            }
          >
            {t('diagnostics.showSaved')}
          </button>
        </div>
      )}
      <footer className="diagnostic-actions">
        {preview && (
          <button
            className="diagnostic-secondary"
            disabled={saving}
            onClick={() =>
              void run(() => window.electronAPI.diagnostics.inspectReport(preview.previewId))
            }
          >
            {t('diagnostics.inspect')}
          </button>
        )}
        <div className="diagnostic-primary-actions">
          {preview && (
            <button
              className="diagnostic-secondary"
              disabled={saving}
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t('diagnostics.collectAgain')}
            </button>
          )}
          {preview ? (
            <button className="primary" disabled={saving} onClick={() => void save()}>
              <Icon name="download" />
              {saving
                ? t('diagnostics.saving')
                : failure?.reason === 'report-save-failed'
                  ? t('diagnostics.saveAgain')
                  : t('diagnostics.save')}
            </button>
          ) : (
            <button
              className="primary"
              disabled={started && !failure}
              onClick={() => setAttempt((value) => value + 1)}
            >
              {failure
                ? t('diagnostics.collectAgain')
                : started
                  ? t('diagnostics.loading')
                  : t('diagnostics.collect')}
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
