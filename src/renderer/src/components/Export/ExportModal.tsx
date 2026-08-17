// ─────────────────────────────────────────────────────────────────────────────
// ExportModal
//
// Triggered from the "Export" button in the transport bar area.
// Shows a format selector, LUFS target, and export progress. Destination
// selection remains main-process owned.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { ExportJobId, RenderProgress } from '@shared/ipc.types'
import type { ProjectDraft, RendererSession, SessionPrecondition } from '@shared/session.types'

interface ExportModalProps {
  session: RendererSession
  draft: ProjectDraft
  onClose: () => void
}

type ExportState =
  | { status: 'idle' }
  | { status: 'exporting'; progress: RenderProgress }
  | { status: 'done' }
  | { status: 'error'; message: string }

interface ActiveExportIdentity extends SessionPrecondition {
  jobId: ExportJobId
}

export function ExportModal({ session, draft, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<ProjectDraft['export']['format']>('mp3')
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const [isCancelling, setIsCancelling] = useState(false)
  const activeJob = useRef<ActiveExportIdentity | null>(null)
  const cancellationOwner = useRef<ActiveExportIdentity | null>(null)
  const currentSession = useRef<SessionPrecondition>({
    workspaceToken: session.workspaceToken,
    revision: session.revision,
  })
  currentSession.current = {
    workspaceToken: session.workspaceToken,
    revision: session.revision,
  }

  useEffect(() => {
    const active = activeJob.current
    if (active && !sameSession(active, currentSession.current)) {
      activeJob.current = null
      cancellationOwner.current = null
      setIsCancelling(false)
      setExportState({ status: 'idle' })
    }
  }, [session.revision, session.workspaceToken])

  // Subscribe to render progress events
  useEffect(() => {
    return window.electronAPI.on.renderProgress((progress) => {
      if (
        !activeJobMatches(activeJob.current, progress) ||
        !sameSession(currentSession.current, progress)
      )
        return
      setExportState({ status: 'exporting', progress })
    })
  }, [])

  const handleExport = useCallback(async () => {
    setExportState({
      status: 'exporting',
      progress: { percent: 0, currentSeconds: 0, totalSeconds: 0 },
    })
    const identity: ActiveExportIdentity = {
      jobId: crypto.randomUUID() as ExportJobId,
      workspaceToken: session.workspaceToken,
      revision: session.revision,
    }
    activeJob.current = identity
    let shouldFinish = false
    try {
      const exported = await window.electronAPI.render.startExport({
        ...identity,
        draft: { ...draft, export: { ...draft.export, format } },
        format,
      })
      if (activeJobMatches(cancellationOwner.current, identity)) return
      if (
        !activeJobMatches(activeJob.current, identity) ||
        !sameSession(currentSession.current, identity) ||
        !activeJobMatches(identity, exported)
      )
        return
      shouldFinish = true
      setExportState(exported.value ? { status: 'done' } : { status: 'idle' })
    } catch (err) {
      if (activeJobMatches(cancellationOwner.current, identity)) return
      if (
        !activeJobMatches(activeJob.current, identity) ||
        !sameSession(currentSession.current, identity)
      )
        return
      shouldFinish = true
      setExportState({ status: 'error', message: (err as Error).message })
    } finally {
      if (shouldFinish && activeJobMatches(activeJob.current, identity)) activeJob.current = null
    }
  }, [draft, format, session.revision, session.workspaceToken])

  const handleCancel = useCallback(async () => {
    const identity = activeJob.current
    if (!identity) {
      onClose()
      return
    }
    cancellationOwner.current = identity
    setIsCancelling(true)
    try {
      await window.electronAPI.render.cancelExport(identity)
      if (
        !activeJobMatches(activeJob.current, identity) ||
        !activeJobMatches(cancellationOwner.current, identity) ||
        !sameSession(currentSession.current, identity)
      )
        return
      setIsCancelling(false)
      cancellationOwner.current = null
      activeJob.current = null
      setExportState({ status: 'idle' })
      onClose()
    } catch (error) {
      if (
        !activeJobMatches(activeJob.current, identity) ||
        !activeJobMatches(cancellationOwner.current, identity) ||
        !sameSession(currentSession.current, identity)
      )
        return
      setIsCancelling(false)
      setExportState({ status: 'error', message: (error as Error).message })
    }
  }, [onClose])

  const isExporting = exportState.status === 'exporting'
  const hasActiveExport = activeJob.current !== null
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
        if (e.target === e.currentTarget && !isCancelling) void handleCancel()
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
            onChange={(e) => setFormat(e.target.value as ProjectDraft['export']['format'])}
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
            Loudness target: {draft.export?.targetLUFS ?? -16} LUFS
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
            onClick={() => void handleCancel()}
            disabled={isCancelling}
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
            {isCancelling ? 'Cancelling…' : exportState.status === 'done' ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => {
              void handleExport()
            }}
            disabled={hasActiveExport || exportState.status === 'done'}
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

function activeJobMatches(
  active: ActiveExportIdentity | null,
  candidate: ActiveExportIdentity,
): boolean {
  return (
    active?.jobId === candidate.jobId &&
    active.workspaceToken === candidate.workspaceToken &&
    active.revision === candidate.revision
  )
}

function sameSession(first: SessionPrecondition, second: SessionPrecondition): boolean {
  return first.workspaceToken === second.workspaceToken && first.revision === second.revision
}
