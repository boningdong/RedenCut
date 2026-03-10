// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Full app — import WAV → peaks → waveform render → playback
//
// Flow:
//   1. User clicks "Open Audio File"
//   2. Main process opens dialog → probes file → returns { filePath, metadata }
//   3. Renderer calls generatePeaks(filePath) → main spawns FFmpeg → peaks.json
//   4. During peak generation, progress bar updates from 'audio:peaks-progress' events
//   5. Once peaks are ready, WaveformView renders the waveform
//   6. TransportBar allows play/pause/seek
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { AudioMetadata, PeakData } from '@shared/project.types'
import { Button } from './components/ui/Button'
import { FileInfoPanel } from './components/FileInfoPanel'
import { WaveformView } from './components/Waveform/WaveformView'
import { TransportBar } from './components/Transport/TransportBar'

// ── State shapes ──────────────────────────────────────────────────────────────
interface OpenedFile {
  filePath: string
  metadata: AudioMetadata
}

type LoadingState =
  | { status: 'idle' }
  | { status: 'opening' }
  | { status: 'generating-peaks'; progress: number }
  | { status: 'ready'; peaks: PeakData }
  | { status: 'error'; message: string }

export default function App() {
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null)
  const [loadingState, setLoadingState] = useState<LoadingState>({ status: 'idle' })

  // ── Subscribe to peak generation progress events ──────────────────────────
  useEffect(() => {
    // window.electronAPI.on.peaksProgress returns a cleanup function.
    // We call it in the useEffect cleanup to prevent listener leaks.
    const unsubscribe = window.electronAPI.on.peaksProgress((progress) => {
      setLoadingState({ status: 'generating-peaks', progress })
    })
    return unsubscribe
  }, [])

  // ── Open file handler ─────────────────────────────────────────────────────
  const handleOpenFile = useCallback(async () => {
    setLoadingState({ status: 'opening' })

    try {
      // Step 1: open file dialog + probe metadata
      const result = await window.electronAPI.audio.openFile()
      if (result === null) {
        setLoadingState({ status: 'idle' })
        return
      }

      setOpenedFile(result)
      setLoadingState({ status: 'generating-peaks', progress: 0 })

      // Step 2: generate peaks (may take 5-30s for a long episode)
      const peaks = await window.electronAPI.audio.generatePeaks(result.filePath)
      setLoadingState({ status: 'ready', peaks })
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      // Log the full error object (with stack trace) to the DevTools console.
      // Open DevTools with Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows).
      // The error is logged as a group so the stack trace is collapsible.
      console.group('[PodCut] Error')
      console.error(err)
      console.groupEnd()
      setLoadingState({ status: 'error', message })
    }
  }, [])

  // ── Derive audio URL for the MediaElement ─────────────────────────────────
  // Chromium's renderer blocks file:// URLs loaded by <audio> elements.
  // We use a custom podcut:// scheme registered in the main process that
  // proxies the request through net.fetch (which has full OS access).
  //
  // Mapping:  /Users/boning/track.mp3
  //        →  podcut://localhost/%2FUsers%2Fboning%2Ftrack.mp3
  //
  // encodeURIComponent encodes the entire absolute path as a single URL
  // segment — slashes included — so the protocol handler can reliably
  // decode it back to the original path.
  const audioUrl = openedFile
    ? `podcut://localhost/${encodeURIComponent(openedFile.filePath)}`
    : null

  const isLoading =
    loadingState.status === 'opening' ||
    loadingState.status === 'generating-peaks'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          height: 40,
          backgroundColor: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 80,
          paddingRight: 12,
          WebkitAppRegion: 'drag',
          flexShrink: 0,
          gap: 'var(--space-3)',
        } as React.CSSProperties}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            flex: 1,
          }}
        >
          PodCut
        </span>

        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenFile}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Open Audio File'}
          </Button>
        </div>
      </div>

      {/* ── File info panel ───────────────────────────────────────────────── */}
      {openedFile && (
        <FileInfoPanel filePath={openedFile.filePath} metadata={openedFile.metadata} />
      )}

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {loadingState.status === 'error' && (
        <ErrorBanner message={loadingState.message} />
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {loadingState.status === 'ready' && audioUrl ? (
          <WaveformView audioUrl={audioUrl} peaks={loadingState.peaks} />
        ) : loadingState.status === 'generating-peaks' ? (
          <PeakGenerationProgress progress={loadingState.progress} />
        ) : (
          <EmptyState onOpen={handleOpenFile} isLoading={isLoading} />
        )}
      </div>

      {/* ── Transport bar ─────────────────────────────────────────────────── */}
      <TransportBar />
    </div>
  )
}

// ── Error banner ──────────────────────────────────────────────────────────────
// Selectable text + Copy button so you can grab the message without opening DevTools.
// The full error (with stack trace) is also sent to console.error() — open
// DevTools with Cmd+Option+I and look for the [PodCut] Error group.
function ErrorBanner({ message }: { message: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [message])

  return (
    <div
      style={{
        padding: '7px 12px 7px 16px',
        backgroundColor: 'var(--color-danger-muted)',
        borderBottom: '1px solid var(--color-danger)',
        color: 'var(--color-danger)',
        fontSize: 'var(--text-sm)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
      }}
    >
      {/* Error text — selectable so you can manually highlight + copy */}
      <span
        ref={textRef}
        style={{
          flex: 1,
          userSelect: 'text',   // override the global `user-select: none` on body
          wordBreak: 'break-all',
          lineHeight: 1.5,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
        }}
      >
        {message}
      </span>

      {/* One-click copy button */}
      <button
        onClick={handleCopy}
        style={{
          flexShrink: 0,
          background: 'none',
          border: '1px solid var(--color-danger)',
          borderRadius: 4,
          color: 'var(--color-danger)',
          fontSize: 'var(--text-xs)',
          padding: '2px 8px',
          cursor: 'pointer',
          opacity: copied ? 0.6 : 1,
          fontFamily: 'var(--font-sans)',
          whiteSpace: 'nowrap',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// ── Peak generation progress ───────────────────────────────────────────────────
function PeakGenerationProgress({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
      }}
    >
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Generating waveform...
      </p>
      <div
        style={{
          width: 240,
          height: 3,
          backgroundColor: 'var(--color-bg-elevated)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: 'var(--color-accent)',
            transition: 'width 0.2s ease',
          }}
        />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
        {pct}%
      </p>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({ onOpen, isLoading }: { onOpen: () => void; isLoading: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-4)',
      }}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)' }}>
          No audio file open
        </p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Open a WAV, MP3, FLAC, or AAC file to get started
        </p>
      </div>
      <Button variant="primary" onClick={onOpen} disabled={isLoading}>
        {isLoading ? 'Loading...' : 'Open Audio File'}
      </Button>
    </div>
  )
}
