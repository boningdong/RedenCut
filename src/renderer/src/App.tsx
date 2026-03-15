// ─────────────────────────────────────────────────────────────────────────────
// App — root component
//
// Layout (left-to-right, top-to-bottom):
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │ TitleBar (40px): traffic lights | app name | Open | Save | Save As  │
//   ├──────────────────────────────────────────────────────────────────────┤
//   │ FileInfoPanel (shown when a file is open)                            │
//   ├──────────────────────────────────┬───┬──────────────────────────────┤
//   │                                  │   │                              │
//   │  Waveform area (flex: 1)         │ ▌ │  Transcript panel            │
//   │    Minimap                       │   │  (resizable, default 280px)  │
//   │    Waveform + regions            │   │                              │
//   │    Timeline                      │   │                              │
//   │                                  │   │                              │
//   ├──────────────────────────────────┴───┴──────────────────────────────┤
//   │ TransportBar (48px): ⏮ ⏸ ⏭  time  ·  Preview                      │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Project state lives in editor.store.
// Transcript state lives in transcript.store.
// Ephemeral loading state lives in local useState.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { AudioMetadata, PeakData, ProjectFile } from '@shared/project.types'
import { APP_NAME, APP_FILE_EXT } from '@shared/constants'
import { Button } from './components/ui/Button'
import { FileInfoPanel } from './components/FileInfoPanel'
import { WaveformView } from './components/Waveform/WaveformView'
import { TransportBar } from './components/Transport/TransportBar'
import { TranscriptPanel } from './components/Transcript/TranscriptPanel'
import { useEditorStore } from './stores/editor.store'
import { useTranscriptStore } from './stores/transcript.store'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

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
  | { status: 'error'; message: string; prevPeaks?: PeakData }

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [openedFile,   setOpenedFile]   = useState<OpenedFile | null>(null)
  const [loadingState, setLoadingState] = useState<LoadingState>({ status: 'idle' })

  // Editor store
  const projectPath    = useEditorStore((s) => s.projectPath)
  const isDirty        = useEditorStore((s) => s.isDirty)
  const edits          = useEditorStore((s) => s.edits)
  const setProjectPath = useEditorStore((s) => s.setProjectPath)
  const setIsDirty     = useEditorStore((s) => s.setIsDirty)
  const setEdits       = useEditorStore((s) => s.setEdits)
  const setProject     = useEditorStore((s) => s.setProject)
  const resetEditor    = useEditorStore((s) => s.reset)

  // Transcript store
  const words               = useTranscriptStore((s) => s.words)
  const isGeneratingTx      = useTranscriptStore((s) => s.isGenerating)
  const generatingTxStatus  = useTranscriptStore((s) => s.generatingStatus)
  const setWords            = useTranscriptStore((s) => s.setWords)
  const setIsGenerating     = useTranscriptStore((s) => s.setIsGenerating)
  const setGeneratingStatus = useTranscriptStore((s) => s.setGeneratingStatus)
  const resetTranscript     = useTranscriptStore((s) => s.reset)

  // ── Resizable transcript panel ────────────────────────────────────────────
  const [transcriptWidth, setTranscriptWidth] = useState(280)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: transcriptWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [transcriptWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - e.clientX  // drag left = wider
      const newW = Math.min(600, Math.max(160, dragRef.current.startWidth + delta))
      setTranscriptWidth(newW)
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Push event subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    return window.electronAPI.on.peaksProgress((progress) => {
      setLoadingState({ status: 'generating-peaks', progress })
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.on.transcriptProgress((status) => {
      setGeneratingStatus(status)
    })
  }, [setGeneratingStatus])

  // ── Core loading helper ───────────────────────────────────────────────────
  /** Probes metadata, generates peaks, and sets the ready state. */
  const loadAudio = useCallback(async (filePath: string, metadata: AudioMetadata) => {
    setOpenedFile({ filePath, metadata })
    setLoadingState({ status: 'generating-peaks', progress: 0 })
    const peaks = await window.electronAPI.audio.generatePeaks(filePath)
    setLoadingState({ status: 'ready', peaks })
  }, [])

  const handleError = useCallback((err: unknown) => {
    const message = (err as Error).message ?? String(err)
    console.group('[PodCut] Error')
    console.error(err)
    console.groupEnd()
    setLoadingState((prev) => ({
      status: 'error',
      message,
      prevPeaks: prev.status === 'ready' ? prev.peaks : undefined,
    }))
  }, [])

  // ── Open audio file (new project) ─────────────────────────────────────────
  const handleOpenAudio = useCallback(async () => {
    setLoadingState({ status: 'opening' })
    try {
      const result = await window.electronAPI.audio.openFile()
      if (!result) { setLoadingState({ status: 'idle' }); return }
      resetEditor()
      resetTranscript()
      await loadAudio(result.filePath, result.metadata)
    } catch (err) { handleError(err) }
  }, [loadAudio, handleError, resetEditor, resetTranscript])

  // ── Open project file ─────────────────────────────────────────────────────
  const handleOpenProject = useCallback(async () => {
    setLoadingState({ status: 'opening' })
    try {
      const result = await window.electronAPI.project.openDialog()
      if (!result) { setLoadingState({ status: 'idle' }); return }

      const { projectPath: pPath, project } = result
      resetEditor()
      resetTranscript()
      setProjectPath(pPath)
      setEdits(project.edits)
      setProject(project)
      if (project.transcript) setWords(project.transcript.words)

      const metadata = await window.electronAPI.audio.probeFile(project.source.file)
      await loadAudio(project.source.file, metadata)
      setIsDirty(false)
    } catch (err) { handleError(err) }
  }, [loadAudio, handleError, resetEditor, resetTranscript, setProjectPath, setEdits, setProject, setWords, setIsDirty])

  // ── Build project snapshot ────────────────────────────────────────────────
  const buildProject = useCallback((): ProjectFile | null => {
    if (!openedFile) return null
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      source: {
        file: openedFile.filePath,
        sampleRate: openedFile.metadata.sampleRate,
        channels: openedFile.metadata.channels,
        durationSeconds: openedFile.metadata.durationSeconds,
      },
      edits,
      transcript: words.length > 0
        ? { engine: 'whisper.cpp', words, speakers: {} }
        : undefined,
      adjustments: [],
      markers: [],
      export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48000 },
      pluginData: {},
    }
  }, [openedFile, edits, words])

  // ── Save / Save As ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const project = buildProject()
    if (!project) return
    try {
      if (projectPath) {
        await window.electronAPI.project.save(project, projectPath)
        setIsDirty(false)
      } else {
        const newPath = await window.electronAPI.project.saveAs(project)
        if (newPath) { setProjectPath(newPath); setIsDirty(false) }
      }
    } catch (err) { handleError(err) }
  }, [buildProject, projectPath, setProjectPath, setIsDirty, handleError])

  const handleSaveAs = useCallback(async () => {
    const project = buildProject()
    if (!project) return
    try {
      const newPath = await window.electronAPI.project.saveAs(project)
      if (newPath) { setProjectPath(newPath); setIsDirty(false) }
    } catch (err) { handleError(err) }
  }, [buildProject, setProjectPath, setIsDirty, handleError])

  // ── Generate transcript ────────────────────────────────────────────────────
  const handleGenerateTranscript = useCallback(async () => {
    if (!openedFile) return
    const reason = await window.electronAPI.transcript.checkAvailability()
    if (reason) { handleError(new Error(reason)); return }

    setIsGenerating(true)
    setGeneratingStatus('Starting…')
    try {
      const transcript = await window.electronAPI.transcript.generate(openedFile.filePath)
      setWords(transcript.words)
      setIsDirty(true)
    } catch (err) { handleError(err) }
    finally { setIsGenerating(false); setGeneratingStatus('') }
  }, [openedFile, setIsGenerating, setGeneratingStatus, setWords, setIsDirty, handleError])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useKeyboardShortcuts({ onSave: handleSave })

  // ── Derived ───────────────────────────────────────────────────────────────
  const audioUrl = openedFile
    ? `podcut://localhost/${encodeURIComponent(openedFile.filePath)}`
    : null

  const isLoading =
    loadingState.status === 'opening' ||
    loadingState.status === 'generating-peaks'

  const projectName = projectPath
    ? (projectPath.split('/').pop() ?? 'Untitled').replace(APP_FILE_EXT, '')
    : 'Untitled'

  const titleLabel = isDirty ? `${projectName} ●` : projectName

  const showTranscriptPanel = loadingState.status === 'ready'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-sans)' }}>

      {/* ── Title bar ────────────────────────────────────────────────────── */}
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
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
          {APP_NAME}{openedFile ? ` — ${titleLabel}` : ''}
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button variant="ghost" size="sm" onClick={handleOpenProject} disabled={isLoading}>Open Project</Button>
          <Button variant="ghost" size="sm" onClick={handleOpenAudio} disabled={isLoading}>
            {isLoading ? 'Loading…' : 'Open Audio'}
          </Button>
          {openedFile && (
            <>
              <Button variant="ghost" size="sm" onClick={handleSave} disabled={!isDirty && !!projectPath}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSaveAs}>Save As…</Button>
            </>
          )}
        </div>
      </div>

      {/* ── File info ─────────────────────────────────────────────────────── */}
      {openedFile && (
        <FileInfoPanel filePath={openedFile.filePath} metadata={openedFile.metadata} />
      )}

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {loadingState.status === 'error' && (
        <ErrorBanner
          message={loadingState.message}
          onDismiss={() =>
            setLoadingState(
              loadingState.prevPeaks
                ? { status: 'ready', peaks: loadingState.prevPeaks }
                : { status: 'idle' },
            )
          }
        />
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left: waveform / loading states */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {loadingState.status === 'ready' && audioUrl ? (
            <WaveformView audioUrl={audioUrl} peaks={loadingState.peaks} />
          ) : loadingState.status === 'generating-peaks' ? (
            <PeakGenerationProgress progress={loadingState.progress} />
          ) : (
            <EmptyState
              onOpenAudio={handleOpenAudio}
              onOpenProject={handleOpenProject}
              isLoading={isLoading}
            />
          )}
        </div>

        {/* Right: transcript panel (only when waveform is ready) */}
        {showTranscriptPanel && (
          <>
            {/* Drag handle */}
            <div
              onMouseDown={handleDragStart}
              style={{
                width: 4,
                flexShrink: 0,
                backgroundColor: 'var(--color-border)',
                cursor: 'col-resize',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-border)'
              }}
            />
            {/* Transcript panel */}
            <div
              style={{
                width: transcriptWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <TranscriptPanel
                onGenerate={handleGenerateTranscript}
                isGenerating={isGeneratingTx}
                generatingStatus={generatingTxStatus}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Transport bar ─────────────────────────────────────────────────── */}
      <TransportBar />
    </div>
  )
}

// ── Error banner ───────────────────────────────────────────────────────────────
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [message])

  return (
    <div style={{ padding: '7px 12px 7px 16px', backgroundColor: 'var(--color-danger-muted)', borderBottom: '1px solid var(--color-danger)', color: 'var(--color-danger)', fontSize: 'var(--text-sm)', flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
      <span style={{ flex: 1, userSelect: 'text', wordBreak: 'break-all', lineHeight: 1.5, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
        {message}
      </span>
      <button onClick={handleCopy} style={{ flexShrink: 0, background: 'none', border: '1px solid var(--color-danger)', borderRadius: 4, color: 'var(--color-danger)', fontSize: 'var(--text-xs)', padding: '2px 8px', cursor: 'pointer', opacity: copied ? 0.6 : 1, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={onDismiss} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 'var(--text-base)', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>
        ×
      </button>
    </div>
  )
}

// ── Peak generation progress ───────────────────────────────────────────────────
function PeakGenerationProgress({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100)
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)' }}>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Generating waveform…
      </p>
      <div style={{ width: 240, height: 3, backgroundColor: 'var(--color-bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: 'var(--color-accent)', transition: 'width 0.2s ease' }} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
        {pct}%
      </p>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({
  onOpenAudio,
  onOpenProject,
  isLoading,
}: {
  onOpenAudio: () => void
  onOpenProject: () => void
  isLoading: boolean
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-base)' }}>No audio file open</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Open a WAV, MP3, FLAC, or AAC file to get started</p>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <Button variant="ghost" onClick={onOpenProject} disabled={isLoading}>Open Project</Button>
        <Button variant="primary" onClick={onOpenAudio} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Open Audio'}
        </Button>
      </div>
    </div>
  )
}
