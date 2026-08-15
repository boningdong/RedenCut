// ─────────────────────────────────────────────────────────────────────────────
// ExportModal
//
// Triggered from the "Export" button in the transport bar area.
// Shows a format selector, LUFS target, and export progress. Destination
// selection remains main-process owned.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect } from 'react'
import type { ProjectFile } from '@shared/project.types'
import type { RenderProgress } from '@shared/ipc.types'

interface ExportModalProps {
  project: ProjectFile
  onClose: () => void
}

type ExportState =
  | { status: 'idle' }
  | { status: 'exporting'; progress: RenderProgress }
  | { status: 'done' }
  | { status: 'error'; message: string }

export function ExportModal({ project, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<ProjectFile['export']['format']>('mp3')
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })

  // Subscribe to render progress events
  useEffect(() => {
    return window.electronAPI.on.renderProgress((p) => {
      setExportState({ status: 'exporting', progress: p })
      if (p.percent >= 1) setExportState({ status: 'done' })
    })
  }, [])

  const handleExport = useCallback(async () => {
    setExportState({
      status: 'exporting',
      progress: { percent: 0, currentSeconds: 0, totalSeconds: 0 },
    })
    try {
      const exportProject: ProjectFile = { ...project, export: { ...project.export, format } }
      const exported = await window.electronAPI.render.export(exportProject, format)
      setExportState(exported ? { status: 'done' } : { status: 'idle' })
    } catch (err) {
      setExportState({ status: 'error', message: (err as Error).message })
    }
  }, [format, project])

  const isExporting = exportState.status === 'exporting'
  const pct =
    exportState.status === 'exporting'
      ? Math.round(exportState.progress.percent * 100)
      : exportState.status === 'done'
        ? 100
        : 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--color-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 24,
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
          Export Audio
        </h2>

        {/* Format */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Format
          </span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ProjectFile['export']['format'])}
            disabled={isExporting}
            style={{
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              color: 'var(--color-text-primary)',
              padding: '4px 8px',
              fontSize: 'var(--text-xs)',
            }}
          >
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
            <option value="flac">FLAC</option>
            <option value="aac">AAC</option>
          </select>
        </label>

        {/* LUFS (display only) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Loudness target: {project.export?.targetLUFS ?? -16} LUFS
          </span>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6 }}>
            (Phase 4)
          </span>
        </div>

        {/* Progress bar */}
        {(isExporting || exportState.status === 'done') && (
          <div>
            <div
              style={{
                width: '100%',
                height: 4,
                background: 'var(--color-bg-elevated)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'var(--color-accent)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                marginTop: 4,
                display: 'block',
              }}
            >
              {exportState.status === 'done' ? 'Done!' : `${pct}%`}
            </span>
          </div>
        )}

        {/* Error */}
        {exportState.status === 'error' && (
          <p
            style={{
              color: 'var(--color-danger)',
              fontSize: 'var(--text-xs)',
              margin: 0,
              wordBreak: 'break-all',
            }}
          >
            {exportState.message}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
              padding: '6px 14px',
              cursor: 'pointer',
            }}
          >
            {exportState.status === 'done' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => {
              void handleExport()
            }}
            disabled={isExporting || exportState.status === 'done'}
            style={{
              background: 'var(--color-accent)',
              border: 'none',
              borderRadius: 4,
              color: 'var(--color-text-on-accent)',
              fontSize: 'var(--text-xs)',
              padding: '6px 14px',
              cursor: 'pointer',
              opacity: isExporting ? 0.5 : 1,
            }}
          >
            {isExporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
