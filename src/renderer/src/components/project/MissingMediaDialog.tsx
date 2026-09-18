import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useMediaRecoveryStore } from '../../stores/MediaRecoveryStore'
import { PreferencesDialog } from '../settings/PreferencesDialog'
import type { MediaRecoveryItemState } from '@shared/MediaRecoveryTypes'
import './missingMedia.css'

export function MissingMediaDialog() {
  const { t } = useTranslation()
  const snapshot = useMediaRecoveryStore((state) => state.snapshot)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const busy =
    pending ||
    snapshot?.items.some(
      (item) => item.state.status === 'selecting' || item.state.status === 'restoring',
    )
  useEffect(() => {
    const dialog = cancelButton.current?.closest('dialog')
    if (!busy && dialog && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
  }, [snapshot, busy])
  if (!snapshot || snapshot.status === 'closed') return null
  const request = { recoveryId: snapshot.recoveryId }
  const restored = snapshot.items.filter((item) => item.state.status === 'restored').length
  const perform = async (action: () => Promise<void>) => {
    setPending(true)
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  const statusText = (state: MediaRecoveryItemState) => {
    switch (state.status) {
      case 'missing':
        return t('mediaRecovery.missing')
      case 'selecting':
        return t('mediaRecovery.selecting')
      case 'restoring':
        return t('mediaRecovery.restoring')
      case 'restored':
        return t('mediaRecovery.restored')
      case 'failed':
        return t(`mediaRecovery.errors.${state.reason}`)
    }
  }
  return (
    <PreferencesDialog
      className="missing-media-dialog"
      label={t('mediaRecovery.title')}
      onClose={() => {
        void perform(() => window.electronAPI.mediaRecovery.cancel(request))
      }}
    >
      <header className="missing-media-heading">
        <div className="missing-media-badge">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7V5h6l2 2h10v13H3zM12 11v4m0 2v.1" />
          </svg>
        </div>
        <div>
          <h2>{t('mediaRecovery.title')}</h2>
          <p>{t('mediaRecovery.description')}</p>
        </div>
      </header>
      <div className="missing-media-content">
        <div className="missing-media-project">
          <span>{snapshot.projectDisplayName}</span>
          <span>{t('mediaRecovery.count', { count: snapshot.items.length })}</span>
        </div>
        <div className="missing-media-files">
          {snapshot.items.map((item) => (
            <div className="missing-media-file" key={item.audioSourceId}>
              <div className="missing-media-row">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12v5m3-7v9m3-6v3" />
                </svg>
                <div className="missing-media-info">
                  <strong>{item.displayName}</strong>
                  <small>
                    {Math.round(item.metadata.sampleRate / 100) / 10} kHz ·{' '}
                    {t('mediaRecovery.channels', { count: item.metadata.channels })} ·{' '}
                    {formatBytes(item.byteLength)}
                  </small>
                </div>
                {item.state.status === 'restored' ? (
                  <span className="missing-media-check" aria-label={t('mediaRecovery.restored')}>
                    ✓
                  </span>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(() =>
                        window.electronAPI.mediaRecovery.locate({
                          ...request,
                          audioSourceId: item.audioSourceId,
                        }),
                      )
                    }
                  >
                    {t(
                      item.state.status === 'failed'
                        ? 'mediaRecovery.retry'
                        : 'mediaRecovery.choose',
                    )}
                  </button>
                )}
              </div>
              <div
                className="missing-media-status"
                data-status={item.state.status}
                role={item.state.status === 'failed' ? 'alert' : 'status'}
              >
                <i />
                {statusText(item.state)}
              </div>
              {item.state.status === 'restoring' && (
                <progress
                  aria-label={t('mediaRecovery.restoring')}
                  max={Math.max(1, item.state.totalBytes)}
                  value={item.state.processedBytes}
                />
              )}
            </div>
          ))}
        </div>
        <p className="missing-media-note">
          {t('mediaRecovery.note')}
          <br />
          {t('mediaRecovery.preserve')}
        </p>
        {failed && (
          <p className="missing-media-error" role="alert">
            {t('mediaRecovery.requestFailed')}
          </p>
        )}
      </div>
      <footer className="missing-media-footer">
        <span role="status">
          {restored === snapshot.items.length
            ? t('mediaRecovery.ready')
            : t('mediaRecovery.summary', { complete: restored, total: snapshot.items.length })}
        </span>
        <button
          ref={cancelButton}
          onClick={() => void perform(() => window.electronAPI.mediaRecovery.cancel(request))}
        >
          {t('mediaRecovery.cancel')}
        </button>
        <button
          className="missing-media-primary"
          disabled={busy || restored !== snapshot.items.length}
          onClick={() => void perform(() => window.electronAPI.mediaRecovery.continue(request))}
        >
          {t('mediaRecovery.open')}
        </button>
      </footer>
    </PreferencesDialog>
  )
}
function formatBytes(bytes: number): string {
  const unit = bytes >= 1024 ** 3 ? 'GB' : 'MB'
  return `${(bytes / (unit === 'GB' ? 1024 ** 3 : 1024 ** 2)).toFixed(1)} ${unit}`
}
