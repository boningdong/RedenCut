import React, { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '@shared/constants'
import type { AudioSourceId, ProjectFile, Word } from '@shared/project.types'
import type {
  AudioSourceCacheDescriptor,
  ImportMode,
  ImportProgress,
  ProjectOpenResult,
  WorkspaceDescriptor,
} from '@shared/import.types'
import { setAudioPlayerInstance, type IAudioPlayer } from '@shared/player.types'
import { WorkletAudioPlayer } from './audio/WorkletAudioPlayer'
import { ContinuousPcmSampleProvider } from './audio/samples/ContinuousPcmSampleProvider'
import { BinaryWaveformDataProvider } from './components/Waveform/BinaryWaveformDataProvider'
import type { WaveformDataProvider } from './components/Waveform/WaveformDataProvider'
import { WaveformView } from './components/Waveform/WaveformView'
import { FileInfoPanel } from './components/FileInfoPanel'
import { TransportBar } from './components/Transport/TransportBar'
import { TranscriptPanel } from './components/Transcript/TranscriptPanel'
import { ExportModal } from './components/Export/ExportModal'
import { Button } from './components/ui/Button'
import { useEditorStore } from './stores/editor.store'
import { usePlaybackStore } from './stores/playback.store'
import { useTimelineStore } from './stores/timeline.store'
import { useTranscriptStore } from './stores/transcript.store'
import { mergeTrackWords } from './utils/transcript'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

interface ImportState {
  id: string
  displayName: string
  stage: string
  percent: number
}

export default function App() {
  const [workspace, setWorkspaceState] = useState<WorkspaceDescriptor | null>(null)
  const [descriptors, setDescriptors] = useState<AudioSourceCacheDescriptor[]>([])
  const [waveforms, setWaveforms] = useState<ReadonlyMap<AudioSourceId, WaveformDataProvider>>(
    new Map(),
  )
  const [importState, setImportState] = useState<ImportState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [transcriptWidth, setTranscriptWidth] = useState(280)
  const playerRef = useRef<IAudioPlayer | null>(null)
  const playerSubscriptions = useRef<(() => void)[]>([])
  const initialized = useRef(false)
  const skipNextTimelineDirty = useRef(false)

  const project = useEditorStore((state) => state.project)
  const isDirty = useEditorStore((state) => state.isDirty)
  const setProject = useEditorStore((state) => state.setProject)
  const setWorkspace = useEditorStore((state) => state.setWorkspace)
  const setIsDirty = useEditorStore((state) => state.setIsDirty)
  const tracks = useTimelineStore((state) => state.tracks)
  const isGenerating = useTranscriptStore((state) => state.isGenerating)
  const generatingStatus = useTranscriptStore((state) => state.generatingStatus)

  const destroyPlayer = useCallback(() => {
    playerSubscriptions.current.splice(0).forEach((unsubscribe) => unsubscribe())
    playerRef.current?.destroy()
    playerRef.current = null
    setAudioPlayerInstance(null)
  }, [])

  const loadSession = useCallback(
    async (result: ProjectOpenResult) => {
      const descriptorsBySourceId = new Map(
        result.sources.map((descriptor) => [descriptor.audioSourceId, descriptor]),
      )
      const rendererSources = result.project.audioSources.map((source) => {
        const cache = descriptorsBySourceId.get(source.id)
        if (!cache) throw new Error(`Missing cache descriptor for audio source ${source.id}`)
        return { id: source.id, displayName: source.displayName, metadata: source.metadata, cache }
      })
      destroyPlayer()
      usePlaybackStore.getState().reset()
      skipNextTimelineDirty.current = true
      useTimelineStore.getState().loadFromProject(rendererSources, result.project.tracks)
      useTranscriptStore.getState().reset()
      useTranscriptStore.getState().setWords(result.project.transcript?.words ?? [])
      for (const track of result.project.tracks) {
        if (result.project.transcript?.words.some((word) => word.trackId === track.id)) {
          useTranscriptStore.getState().ensureTrackVisible(track.id)
        }
      }

      const player = new WorkletAudioPlayer()
      const waveformProviders = new Map<AudioSourceId, WaveformDataProvider>()
      for (const descriptor of result.sources) {
        await player.registerAudioSource(
          descriptor.audioSourceId,
          new ContinuousPcmSampleProvider(descriptor),
        )
        waveformProviders.set(descriptor.audioSourceId, new BinaryWaveformDataProvider(descriptor))
      }
      player.setTracks(result.project.tracks)
      playerSubscriptions.current = [
        player.onTimeUpdate(usePlaybackStore.getState().setCurrentTime),
        player.onPlayStateChange(usePlaybackStore.getState().setPlaying),
        player.onDurationChange(usePlaybackStore.getState().setDuration),
        player.onEnded(() => usePlaybackStore.getState().setPlaying(false)),
        player.onError((playbackError) => setError(playbackError.message)),
      ]
      usePlaybackStore.getState().setDuration(player.getDuration())
      playerRef.current = player
      setAudioPlayerInstance(player)
      setProject(result.project)
      setWorkspace(result.workspace)
      setWorkspaceState(result.workspace)
      setDescriptors(result.sources)
      setWaveforms(waveformProviders)
      setIsDirty(false)
      setError(null)
    },
    [destroyPlayer, setIsDirty, setProject, setWorkspace],
  )

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void window.electronAPI.project
      .initialize()
      .then(loadSession)
      .catch((reason: unknown) => {
        setError((reason as Error).message)
      })
    return destroyPlayer
  }, [destroyPlayer, loadSession])

  useEffect(
    () =>
      window.electronAPI.on.importProgress((progress: ImportProgress) => {
        setImportState((current) =>
          current?.id === progress.importId
            ? {
                id: progress.importId,
                displayName: progress.displayName,
                stage: progress.stage,
                percent: progress.percent,
              }
            : current,
        )
      }),
    [],
  )

  useEffect(
    () =>
      window.electronAPI.on.transcriptProgress(useTranscriptStore.getState().setGeneratingStatus),
    [],
  )

  useEffect(() => {
    playerRef.current?.setTracks(tracks)
    if (skipNextTimelineDirty.current) {
      skipNextTimelineDirty.current = false
    } else if (useEditorStore.getState().project) {
      setIsDirty(true)
    }
  }, [setIsDirty, tracks])

  const snapshot = useCallback((): ProjectFile | null => {
    const current = useEditorStore.getState().project
    if (!current) return null
    const currentWords = useTranscriptStore.getState().words
    return {
      ...current,
      tracks: useTimelineStore.getState().tracks,
      transcript:
        currentWords.length > 0 || current.transcript
          ? {
              engine: current.transcript?.engine ?? 'whisper',
              model: current.transcript?.model,
              speakers: current.transcript?.speakers ?? {},
              words: currentWords,
            }
          : undefined,
    }
  }, [])

  const save = useCallback(
    async (saveAs = false) => {
      const current = snapshot()
      if (!current) return
      const nextWorkspace = await (saveAs
        ? window.electronAPI.project.saveAs(current)
        : window.electronAPI.project.save(current))
      if (!nextWorkspace) return
      setProject(current)
      setWorkspace(nextWorkspace)
      setWorkspaceState(nextWorkspace)
      setIsDirty(false)
    },
    [setIsDirty, setProject, setWorkspace, snapshot],
  )

  useKeyboardShortcuts({
    onSave: () => void save(false).catch((reason: unknown) => setError((reason as Error).message)),
  })

  const importAudio = useCallback(
    async (mode: ImportMode) => {
      const current = snapshot()
      if (!current || importState) return
      const selection = await window.electronAPI.audio.selectImportFile()
      if (!selection) return
      const id = crypto.randomUUID()
      setImportState({ id, displayName: selection.displayName, stage: 'selected', percent: 0 })
      setError(null)
      try {
        const imported = await window.electronAPI.audio.startImport(
          id,
          selection.token,
          mode,
          current,
        )
        if (!workspace) throw new Error('Workspace is not initialized')
        const nextWorkspace = {
          ...workspace,
          portable: imported.project.audioSources.every(
            (source) => source.location.mode === 'copy',
          ),
        }
        const sources = [
          ...descriptors.filter((item) => item.audioSourceId !== imported.source.id),
          imported.cache,
        ]
        await loadSession({ project: imported.project, workspace: nextWorkspace, sources })
        setIsDirty(false)
      } catch (reason) {
        setError((reason as Error).message)
      } finally {
        setImportState(null)
      }
    },
    [descriptors, importState, loadSession, setIsDirty, snapshot, workspace],
  )

  const cancelImport = useCallback(async () => {
    if (!importState) return
    await window.electronAPI.audio.cancelImport(importState.id)
  }, [importState])

  const openProject = useCallback(async () => {
    const result = await window.electronAPI.project.openDialog()
    if (result) await loadSession(result)
  }, [loadSession])

  const generateTranscript = useCallback(
    async (trackId?: string) => {
      const track =
        useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId) ??
        useTimelineStore.getState().tracks[0]
      const sourceId = track?.clips[0]?.audioSourceId
      if (!track || !sourceId) return
      const transcript = useTranscriptStore.getState()
      transcript.setIsGenerating(true)
      try {
        const generated = await window.electronAPI.transcript.generate(sourceId)
        const incoming: Word[] = generated.words.map((word) => ({
          ...word,
          audioSourceId: sourceId,
          trackId: track.id,
        }))
        const merged = mergeTrackWords(transcript.words, incoming, track.id, sourceId)
        transcript.setWords(merged)
        const currentProject = useEditorStore.getState().project
        if (currentProject)
          setProject({ ...currentProject, transcript: { ...generated, words: merged } })
        transcript.ensureTrackVisible(track.id)
        setIsDirty(true)
      } catch (reason) {
        setError((reason as Error).message)
      } finally {
        transcript.setIsGenerating(false)
        transcript.setGeneratingStatus('')
      }
    },
    [setIsDirty, setProject],
  )

  const primarySource = project?.audioSources[0]
  const projectDuration = tracks
    .flatMap((track) => track.clips)
    .reduce(
      (maximum, clip) => Math.max(maximum, clip.outputStart + clip.sourceEnd - clip.sourceStart),
      0,
    )
  const exportProject = showExport ? snapshot() : null

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-primary)',
      }}
    >
      <header
        style={
          {
            height: 42,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            borderBottom: '1px solid var(--color-border)',
            WebkitAppRegion: 'drag',
          } as React.CSSProperties
        }
      >
        <strong style={{ marginRight: 'auto' }}>
          {APP_NAME}
          {workspace ? ` — ${workspace.displayName}` : ''}
          {isDirty ? ' •' : ''}
        </strong>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() =>
              void openProject().catch((reason: unknown) => setError((reason as Error).message))
            }
          >
            Open Project
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() => void importAudio('copy')}
          >
            Import Audio
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() => void importAudio('reference')}
          >
            Import as Reference
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() => void save(false)}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() => void save(true)}
          >
            Save As
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowExport(true)}
            disabled={!project?.tracks.length}
          >
            Export
          </Button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            color: 'var(--color-danger)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {error}
        </div>
      )}
      {importState && (
        <div
          style={{
            padding: '8px 12px',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span style={{ flex: 1 }}>
            Importing {importState.displayName}: {importState.stage} (
            {Math.round(importState.percent * 100)}%)
          </span>
          <Button size="sm" variant="ghost" onClick={() => void cancelImport()}>
            Cancel
          </Button>
        </div>
      )}

      {primarySource ? (
        <FileInfoPanel displayName={primarySource.displayName} metadata={primarySource.metadata} />
      ) : null}

      <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <section style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {tracks.length > 0 ? (
            <WaveformView
              duration={projectDuration}
              providersBySource={waveforms}
              onAddTrack={() => void importAudio('copy')}
            />
          ) : (
            <div
              style={{
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--color-text-muted)',
              }}
            >
              <Button variant="primary" onClick={() => void importAudio('copy')}>
                Import your first audio file
              </Button>
            </div>
          )}
        </section>
        <div
          onPointerDown={(event) => {
            const startX = event.clientX
            const startWidth = transcriptWidth
            const move = (moveEvent: PointerEvent) =>
              setTranscriptWidth(
                Math.min(600, Math.max(180, startWidth + startX - moveEvent.clientX)),
              )
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
          style={{ width: 4, cursor: 'col-resize', background: 'var(--color-border)' }}
        />
        <aside style={{ width: transcriptWidth, minWidth: 180, overflow: 'auto' }}>
          <TranscriptPanel
            onGenerate={(trackId) => void generateTranscript(trackId)}
            isGenerating={isGenerating}
            generatingStatus={generatingStatus}
          />
        </aside>
      </main>
      <TransportBar />
      {showExport && exportProject ? (
        <ExportModal project={exportProject} onClose={() => setShowExport(false)} />
      ) : null}
    </div>
  )
}
