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
//   │    Waveform + regions            │   │  (resizable, default 280px)  │
//   │    Timeline                      │   │                              │
//   │                                  │   │                              │
//   ├──────────────────────────────────┴───┴──────────────────────────────┤
//   │ TransportBar (48px): ⏮ ⏸ ⏭  time  ·  Preview                      │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Player lifecycle:
//   1. User opens a file → loadAudio() creates a WebCodecsPlayer (or SimpleAudioPlayer fallback)
//   2. Player loads source file, initialises timeline.store
//   3. Player callbacks feed into playback.store (currentTime, isPlaying, duration)
//   4. WaveformView reads playback.store for display; timeline.store for regions
//   5. When file closes / new file opens → player.destroy(), new player created
//
// Player selection (runtime, inside loadAudio):
//   WebCodecsPlayer  — AudioDecoder available + codec supported → frame-accurate skip
//   SimpleAudioPlayer — fallback; linear playback with gain=0 for muted regions
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { AudioMetadata, PeakData, ProjectFile, Word } from '@shared/project.types'
import { APP_NAME, APP_FILE_EXT } from '@shared/constants'
import type { IAudioPlayer } from '@shared/player.types'
import { setAudioPlayerInstance } from '@shared/player.types'
import { SimpleAudioPlayer } from './audio/SimpleAudioPlayer'
import { WebCodecsPlayer } from './audio/WebCodecsPlayer'
import { Button } from './components/ui/Button'
import { FileInfoPanel } from './components/FileInfoPanel'
import { WaveformView } from './components/Waveform/WaveformView'
import { TransportBar } from './components/Transport/TransportBar'
import { TranscriptPanel } from './components/Transcript/TranscriptPanel'
import { useEditorStore } from './stores/editor.store'
import { usePlaybackStore } from './stores/playback.store'
import { useTranscriptStore } from './stores/transcript.store'
import { useTimelineStore } from './stores/timeline.store'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { mergeTrackWords } from './utils/transcript'
import { ExportModal } from './components/Export/ExportModal'

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
  const [showExport,   setShowExport]   = useState(false)

  // The active IAudioPlayer instance — created/destroyed as files open/close
  const playerRef = useRef<IAudioPlayer | null>(null)

  // Editor store
  const projectPath    = useEditorStore((s) => s.projectPath)
  const isDirty        = useEditorStore((s) => s.isDirty)
  const setProjectPath = useEditorStore((s) => s.setProjectPath)
  const setIsDirty     = useEditorStore((s) => s.setIsDirty)
  const setProject     = useEditorStore((s) => s.setProject)
  const resetEditor    = useEditorStore((s) => s.reset)

  // Playback store setters (written from player callbacks, NOT from WaveSurfer)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setPlaying     = usePlaybackStore((s) => s.setPlaying)
  const setDuration    = usePlaybackStore((s) => s.setDuration)
  const resetPlayback  = usePlaybackStore((s) => s.reset)

  // Transcript store
  const words               = useTranscriptStore((s) => s.words)
  const isGeneratingTx      = useTranscriptStore((s) => s.isGenerating)
  const generatingTxStatus  = useTranscriptStore((s) => s.generatingStatus)
  const setWords            = useTranscriptStore((s) => s.setWords)
  const setIsGenerating     = useTranscriptStore((s) => s.setIsGenerating)
  const setGeneratingStatus = useTranscriptStore((s) => s.setGeneratingStatus)
  const ensureTrackVisible  = useTranscriptStore((s) => s.ensureTrackVisible)
  const resetTranscript     = useTranscriptStore((s) => s.reset)

  // Timeline store
  const tracks       = useTimelineStore((s) => s.tracks)
  const resetTimeline = useTimelineStore((s) => s.reset)

  // ── Keep player in sync whenever the clip model changes ───────────────────
  // When keyboard shortcuts mutate tracks (mute/unmute/split), the player
  // needs updated gain info. setTracks() is cheap — just replaces the array ref.
  useEffect(() => {
    playerRef.current?.setTracks(tracks)
  }, [tracks])

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
      const delta = dragRef.current.startX - e.clientX
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
      setLoadingState((prev) =>
        prev.status === 'generating-peaks'
          ? { status: 'generating-peaks', progress }
          : prev
      )
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.on.transcriptProgress((status) => {
      setGeneratingStatus(status)
    })
  }, [setGeneratingStatus])

  // ── Destroy player on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      playerRef.current?.destroy()
      setAudioPlayerInstance(null)
    }
  }, [])

  // ── Core loading helper ───────────────────────────────────────────────────
  /**
   * Given an already-probed file path + metadata:
   *   1. Tear down any existing player
   *   2. Init timeline.store (creates Track + Clip for the full duration)
   *   3. Create SimpleAudioPlayer, load source file, wire callbacks → stores
   *   4. Generate waveform peaks (may take a few seconds for large files)
   *   5. Transition to 'ready' state → WaveformView mounts
   */
  const loadAudio = useCallback(async (
    filePath: string,
    metadata: AudioMetadata,
    /** Pass false when the timeline is already loaded (e.g. opening a saved project). */
    shouldInitTimeline = true,
  ) => {
    setOpenedFile({ filePath, metadata })
    setLoadingState({ status: 'generating-peaks', progress: 0 })

    // ── 1. Destroy existing player ───────────────────────────────────────
    if (playerRef.current) {
      console.log('[App] destroying old player')
      playerRef.current.destroy()
      playerRef.current = null
      setAudioPlayerInstance(null)
    }
    resetPlayback()

    // ── 2. Initialise timeline (skipped when project was already loaded above) ─
    if (shouldInitTimeline) {
      useTimelineStore.getState().initFromFile(filePath, metadata.durationSeconds)
    }
    const { tracks: initTracks } = useTimelineStore.getState()
    console.log(`[App] timeline init — ${initTracks.length} tracks, sourceFileId=${filePath}`)

    // ── 3. Create player and load all source files ────────────────────────
    // Prefer WebCodecsPlayer (frame-accurate skip + multi-source mixing).
    // Fall back to SimpleAudioPlayer if WebCodecs AudioDecoder is unavailable.
    //
    // Load every source file registered in the timeline store — this handles
    // single-file projects (one source) and multi-track projects (N sources).
    // The primary file is always loaded first so it sets the AudioContext rate.
    const { sourceFiles } = useTimelineStore.getState()
    const orderedSources = [
      { id: filePath, filePath },
      ...sourceFiles
        .filter((sf) => sf.filePath !== filePath)
        .map((sf) => ({ id: sf.id, filePath: sf.filePath })),
    ]

    let player: IAudioPlayer
    if (typeof AudioDecoder !== 'undefined') {
      const wcPlayer = new WebCodecsPlayer()
      try {
        for (const { id, filePath: fp } of orderedSources) {
          await wcPlayer.loadSourceFile(id, fp)
        }
        player = wcPlayer
        console.log(`[App] using WebCodecsPlayer (${orderedSources.length} source(s))`)
      } catch (err) {
        console.warn('[App] WebCodecsPlayer unavailable, falling back to SimpleAudioPlayer:', err)
        wcPlayer.destroy()
        const sPlayer = new SimpleAudioPlayer()
        for (const { id, filePath: fp } of orderedSources) {
          await sPlayer.loadSourceFile(id, fp).catch((e) => {
            console.warn(`[App] SimpleAudioPlayer: could not load secondary source id=${id}:`, e)
          })
        }
        player = sPlayer
      }
    } else {
      console.log('[App] AudioDecoder not available — using SimpleAudioPlayer')
      const sPlayer = new SimpleAudioPlayer()
      for (const { id, filePath: fp } of orderedSources) {
        await sPlayer.loadSourceFile(id, fp).catch((e) => {
          console.warn(`[App] SimpleAudioPlayer: could not load secondary source id=${id}:`, e)
        })
      }
      player = sPlayer
    }

    playerRef.current = player

    // Pass initial tracks so the player knows about any clips
    player.setTracks(initTracks)

    // Wire player callbacks → playback store (updates at 60fps)
    player.onTimeUpdate((t) => usePlaybackStore.getState().setCurrentTime(t))
    player.onPlayStateChange((p) => usePlaybackStore.getState().setPlaying(p))
    player.onDurationChange((d) => {
      console.log(`[App] player duration changed: ${d.toFixed(2)}s`)
      usePlaybackStore.getState().setDuration(d)
    })
    player.onEnded(() => {
      usePlaybackStore.getState().setPlaying(false)
      usePlaybackStore.getState().setCurrentTime(0)
    })

    // Seed duration from metadata (player's onDurationChange fires async)
    setDuration(metadata.durationSeconds)

    // Expose to WaveformView, TransportBar, keyboard shortcuts
    setAudioPlayerInstance(player)
    console.log('[App] player ready and registered')

    // ── 4. Generate waveform peaks (main-process FFmpeg call) ─────────────
    const peaks = await window.electronAPI.audio.generatePeaks(filePath)

    // ── 5. Transition to ready — WaveformView mounts ──────────────────────
    setLoadingState({ status: 'ready', peaks })
  }, [resetPlayback, setDuration]) // eslint-disable-line react-hooks/exhaustive-deps

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
      resetTimeline()
      await loadAudio(result.filePath, result.metadata)
    } catch (err) { handleError(err) }
  }, [loadAudio, handleError, resetEditor, resetTranscript, resetTimeline])

  // ── Open project file ─────────────────────────────────────────────────────
  const handleOpenProject = useCallback(async () => {
    setLoadingState({ status: 'opening' })
    try {
      const result = await window.electronAPI.project.openDialog()
      if (!result) { setLoadingState({ status: 'idle' }); return }

      const { projectPath: pPath, project } = result
      resetEditor()
      resetTranscript()
      resetTimeline()
      setProjectPath(pPath)
      setProject(project)
      const rawWords = project.transcript?.words ?? null

      // Backfill sourceFileId now — we know it from the saved project data.
      // trackId backfill is deferred until after the timeline is initialised
      // so we use the real track ID rather than a stale lookup on an empty array.
      let backfilled = rawWords
        ? (() => {
            const primarySfId = project.sourceFiles[0]?.id ?? project.source.file
            if (!project.sourceFiles[0]?.id) {
              console.warn('[App] handleOpenProject: sourceFiles[] empty — backfilling words with relative path', primarySfId)
            }
            return rawWords.map((w) => ({
              ...w,
              sourceFileId: w.sourceFileId ?? primarySfId,
            }))
          })()
        : null

      // Resolve audio metadata for the saved source file
      const metadata = await window.electronAPI.audio.probeFile(project.source.file)

      // Restore timeline from saved project (new format) or migrate from edits[]
      if (project.sourceFiles.length > 0 && project.tracks.length > 0) {
        // Project was saved with the new multi-track model — load directly
        useTimelineStore.getState().loadFromProject(project.sourceFiles, project.tracks)
        console.log('[App] opened project with multi-track model')
      } else {
        // Legacy project: create a single-file timeline from source + edits[]
        useTimelineStore.getState().initFromFile(project.source.file, project.source.durationSeconds)
        for (const edit of project.edits) {
          if (edit.type === 'mute') {
            useTimelineStore.getState().muteRange(
              project.source.file,
              edit.start,
              edit.end,
            )
          }
        }
        console.log(`[App] opened legacy project — migrated ${project.edits.length} edits to clips`)
      }

      // Backfill trackId now that the timeline is initialised and we have the real track ID.
      if (backfilled) {
        const actualFirstTrackId = useTimelineStore.getState().tracks[0]?.id
        const withTrackId = backfilled.map((w) => ({
          ...w,
          trackId: w.trackId ?? actualFirstTrackId,
        }))
        setWords(withTrackId)
        // Make all tracks that have words visible immediately on open
        const distinctTrackIds = [...new Set(withTrackId.map((w) => w.trackId).filter(Boolean) as string[])]
        for (const tId of distinctTrackIds) ensureTrackVisible(tId)
      }

      // false = don't call initFromFile — timeline is already set above
      await loadAudio(project.source.file, metadata, false)
      setIsDirty(false)
    } catch (err) { handleError(err) }
  }, [loadAudio, handleError, resetEditor, resetTranscript, resetTimeline,
      setProjectPath, setProject, setWords, setIsDirty, ensureTrackVisible])

  // ── Build project snapshot ────────────────────────────────────────────────
  const buildProject = useCallback((): ProjectFile | null => {
    if (!openedFile) return null
    const { sourceFiles, tracks: currentTracks } = useTimelineStore.getState()
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      source: {
        file: openedFile.filePath,
        sampleRate: openedFile.metadata.sampleRate,
        channels: openedFile.metadata.channels,
        durationSeconds: openedFile.metadata.durationSeconds,
      },
      // Derive legacy edits[] from muted clips for backward compatibility
      edits: currentTracks.flatMap((t) =>
        t.clips
          .filter((c) => c.muted)
          .map((c) => ({
            id: `edit-${c.id}`,
            type: 'mute' as const,
            start: c.sourceStart,
            end: c.sourceEnd,
            source: 'manual' as const,
          })),
      ),
      transcript: words.length > 0
        ? { engine: 'whisper.cpp', words, speakers: {} }
        : undefined,
      adjustments: [],
      markers: [],
      export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48000 },
      pluginData: {},
      // New multi-track fields
      sourceFiles,
      tracks: currentTracks,
    }
  }, [openedFile, words])

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
  const handleGenerateTranscript = useCallback(async (trackId?: string) => {
    const reason = await window.electronAPI.transcript.checkAvailability()
    if (reason) { handleError(new Error(reason)); return }

    const { tracks: currentTracks, sourceFiles: currentSFs } = useTimelineStore.getState()

    // Collect which (track, sourceFile) pairs to transcribe.
    // A track can reference multiple source files (one per clip group), so we
    // collect all unique sourceFileIds per track.
    const targets: { sf: (typeof currentSFs)[0]; trackId: string }[] = []
    const addTargetsForTrack = (track: (typeof currentTracks)[0]) => {
      const sfIds = [...new Set(
        track.clips.map((c) => c.sourceFileId).filter((id): id is string => !!id)
      )]
      for (const sfId of sfIds) {
        const sf = currentSFs.find((s) => s.id === sfId)
        if (sf) targets.push({ sf, trackId: track.id })
      }
    }

    if (trackId) {
      const track = currentTracks.find((t) => t.id === trackId)
      if (track) addTargetsForTrack(track)
    } else {
      for (const track of currentTracks) addTargetsForTrack(track)
    }
    if (targets.length === 0) return

    setIsGenerating(true)
    setGeneratingStatus('Starting…')
    try {
      // Accumulate tagged words per trackId. We merge once per track at the end
      // so multiple source files on the same track don't overwrite each other.
      const taggedByTrack = new Map<string, Word[]>()

      for (const { sf, trackId: tId } of targets) {
        setGeneratingStatus(targets.length > 1 ? `Transcribing ${sf.filePath.split('/').pop()}…` : 'Transcribing…')
        const transcript  = await window.electronAPI.transcript.generate(sf.filePath)
        const taggedWords: Word[] = transcript.words.map((w) => ({
          ...w,
          // Include sfId so IDs remain unique across multiple source files
          // (Whisper resets its internal counter per call).
          id:           `${tId}_${sf.id}_${w.id}`,
          sourceFileId: sf.id,
          trackId:      tId,
        }))
        taggedByTrack.set(tId, [...(taggedByTrack.get(tId) ?? []), ...taggedWords])
      }

      let currentWords = useTranscriptStore.getState().words
      for (const [tId, tagged] of taggedByTrack) {
        const firstSf = targets.find((t) => t.trackId === tId)?.sf
        currentWords = mergeTrackWords(currentWords, tagged, tId, firstSf?.id)
      }
      setWords(currentWords)
      for (const tId of taggedByTrack.keys()) {
        ensureTrackVisible(tId)
      }
      setIsDirty(true)
    } catch (err) { handleError(err) }
    finally { setIsGenerating(false); setGeneratingStatus('') }
  }, [setIsGenerating, setGeneratingStatus, setWords, setIsDirty, handleError, ensureTrackVisible])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useKeyboardShortcuts({ onSave: handleSave })

  // ── Derived ───────────────────────────────────────────────────────────────
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
              <Button variant="ghost" size="sm" onClick={() => setShowExport(true)}>Export</Button>
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
          {loadingState.status === 'ready' ? (
            <WaveformView peaks={loadingState.peaks} />
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

      {/* ── Export modal ──────────────────────────────────────────────────── */}
      {showExport && loadingState.status === 'ready' && (
        <ExportModal
          project={buildProject()!}
          onClose={() => setShowExport(false)}
        />
      )}
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
