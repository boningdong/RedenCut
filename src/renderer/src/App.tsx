import React, { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '@shared/constants'
import type { AudioSourceId, Word } from '@shared/project.types'
import type { ImportMode } from '@shared/import.types'
import type {
  ProjectDraft,
  RendererSession,
  SessionPrecondition,
  WorkspaceToken,
} from '@shared/session.types'
import type { TranscriptionJobId } from '@shared/transcriber.types'
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
import { createSessionLoadCoordinator, type SessionLoadCoordinator } from './sessionLoadCoordinator'
import { reconcileImportedSession } from './importSessionReconciler'

interface ImportState {
  id: string
  workspaceToken: WorkspaceToken
  revision: number
  displayName: string
  stage: string
  percent: number
}

interface TranscriptJobIdentity extends SessionPrecondition {
  jobId: TranscriptionJobId
}

interface PreparedRendererSession {
  player: IAudioPlayer
  subscriptions: (() => void)[]
  waveforms: ReadonlyMap<AudioSourceId, WaveformDataProvider>
}

interface RendererSessionLoad {
  session: RendererSession
  importLedger?: {
    submittedDraft: ProjectDraft
    submittedLocalEditRevision: number
  }
}

function snapshotDraft(): ProjectDraft | null {
  const current = useEditorStore.getState().session
  if (!current) return null
  const currentWords = useTranscriptStore.getState().words
  return {
    tracks: useTimelineStore.getState().tracks,
    transcript:
      currentWords.length > 0 || current.draft.transcript
        ? {
            engine: current.draft.transcript?.engine ?? 'whisper',
            model: current.draft.transcript?.model,
            speakers: current.draft.transcript?.speakers ?? {},
            words: currentWords,
          }
        : undefined,
    export: current.draft.export,
  }
}

export default function App() {
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
  const transcriptJob = useRef<TranscriptJobIdentity | null>(null)
  const loadCoordinator = useRef<SessionLoadCoordinator<RendererSessionLoad> | null>(null)

  const session = useEditorStore((state) => state.session)
  const isDirty = useEditorStore((state) => state.isDirty)
  const loadEditorSession = useEditorStore((state) => state.loadSession)
  const markEdited = useEditorStore((state) => state.markEdited)
  const acknowledgeSave = useEditorStore((state) => state.acknowledgeSave)
  const tracks = useTimelineStore((state) => state.tracks)
  const isGenerating = useTranscriptStore((state) => state.isGenerating)
  const generatingStatus = useTranscriptStore((state) => state.generatingStatus)

  const destroyPlayer = useCallback(() => {
    playerSubscriptions.current.splice(0).forEach((unsubscribe) => unsubscribe())
    playerRef.current?.destroy()
    playerRef.current = null
    setAudioPlayerInstance(null)
  }, [])

  if (!loadCoordinator.current) {
    loadCoordinator.current = createSessionLoadCoordinator(
      async ({ session: result }: RendererSessionLoad): Promise<PreparedRendererSession> => {
        const player = new WorkletAudioPlayer()
        try {
          const waveformProviders = new Map<AudioSourceId, WaveformDataProvider>()
          for (const source of result.sources) {
            await player.registerAudioSource(
              source.id,
              new ContinuousPcmSampleProvider(source.cache),
            )
            waveformProviders.set(source.id, new BinaryWaveformDataProvider(source.cache))
          }
          player.setTracks(result.draft.tracks)
          return {
            player,
            waveforms: waveformProviders,
            subscriptions: [
              player.onTimeUpdate(usePlaybackStore.getState().setCurrentTime),
              player.onPlayStateChange(usePlaybackStore.getState().setPlaying),
              player.onDurationChange(usePlaybackStore.getState().setDuration),
              player.onEnded(() => usePlaybackStore.getState().setPlaying(false)),
              player.onError((playbackError) => setError(playbackError.message)),
            ],
          }
        } catch (error) {
          player.destroy()
          throw error
        }
      },
      (request, prepared) => {
        let result = request.session
        let preserveDirty = false
        const latestDraft = request.importLedger ? snapshotDraft() : null
        if (request.importLedger && latestDraft) {
          const reconciled = reconcileImportedSession(
            result,
            request.importLedger.submittedDraft,
            latestDraft,
            request.importLedger.submittedLocalEditRevision,
            useEditorStore.getState().localEditRevision,
          )
          result = reconciled.session
          preserveDirty = reconciled.preserveDirty
          prepared.player.setTracks(result.draft.tracks)
        }
        destroyPlayer()
        usePlaybackStore.getState().reset()
        useTimelineStore.getState().loadFromProject(result.sources, result.draft.tracks)
        useTranscriptStore.getState().reset()
        useTranscriptStore.getState().setWords(result.draft.transcript?.words ?? [])
        for (const track of result.draft.tracks) {
          if (result.draft.transcript?.words.some((word) => word.trackId === track.id))
            useTranscriptStore.getState().ensureTrackVisible(track.id)
        }
        playerSubscriptions.current = prepared.subscriptions
        usePlaybackStore.getState().setDuration(prepared.player.getDuration())
        playerRef.current = prepared.player
        setAudioPlayerInstance(prepared.player)
        loadEditorSession(result, preserveDirty)
        setWaveforms(prepared.waveforms)
        setError(null)
      },
      (prepared) => {
        prepared.subscriptions.forEach((unsubscribe) => unsubscribe())
        prepared.player.destroy()
      },
    )
  }

  const invalidateTranscriptJob = useCallback(() => {
    transcriptJob.current = null
    useTranscriptStore.getState().setIsGenerating(false)
    useTranscriptStore.getState().setGeneratingStatus('')
  }, [])

  const invalidateTranscriptJobForSession = useCallback(
    (appliedSession: SessionPrecondition | null) => {
      if (
        transcriptJob.current &&
        !sessionMatchesTranscriptJob(appliedSession, transcriptJob.current)
      )
        invalidateTranscriptJob()
    },
    [invalidateTranscriptJob],
  )

  const loadSession = useCallback(
    (result: RendererSession, importLedger?: RendererSessionLoad['importLedger']) => {
      invalidateTranscriptJob()
      return loadCoordinator.current!.load({ session: result, importLedger })
    },
    [invalidateTranscriptJob],
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
    return () => {
      loadCoordinator.current?.invalidate()
      destroyPlayer()
    }
  }, [destroyPlayer, loadSession])

  useEffect(
    () =>
      window.electronAPI.on.importProgress((progress) => {
        setImportState((current) =>
          current?.id === progress.jobId &&
          current.workspaceToken === progress.workspaceToken &&
          current.revision === progress.revision
            ? {
                ...current,
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
      window.electronAPI.on.transcriptProgress((progress) => {
        const current = useEditorStore.getState().session
        if (
          transcriptJobMatches(transcriptJob.current, progress) &&
          sessionMatchesTranscriptJob(current, progress)
        )
          useTranscriptStore.getState().setGeneratingStatus(progress.status)
      }),
    [],
  )

  useEffect(() => {
    playerRef.current?.setTracks(tracks)
  }, [tracks])

  const snapshot = useCallback(snapshotDraft, [])

  const save = useCallback(
    async (saveAs = false) => {
      const current = snapshot()
      const currentSession = useEditorStore.getState().session
      if (!current || !currentSession) return
      const capturedLocalEditRevision = useEditorStore.getState().localEditRevision
      try {
        const saved = await (saveAs
          ? window.electronAPI.project.saveAs({
              workspaceToken: currentSession.workspaceToken,
              revision: currentSession.revision,
              draft: current,
            })
          : window.electronAPI.project.save({
              workspaceToken: currentSession.workspaceToken,
              revision: currentSession.revision,
              draft: current,
            }))
        if (!saved) return
        acknowledgeSave(saved, capturedLocalEditRevision)
        invalidateTranscriptJobForSession(useEditorStore.getState().session)
        setError(null)
      } catch (reason) {
        setError((reason as Error).message)
      }
    },
    [acknowledgeSave, invalidateTranscriptJobForSession, snapshot],
  )

  useKeyboardShortcuts({
    onSave: () => void save(false),
  })

  const importAudio = useCallback(
    async (mode: ImportMode) => {
      const selectionSession = useEditorStore.getState().session
      if (!selectionSession || importState) return
      const selection = await window.electronAPI.audio.selectImportFile(selectionSession)
      if (!selection) return
      const submittedDraft = snapshot()
      const submittedSession = useEditorStore.getState().session
      if (
        !submittedDraft ||
        !submittedSession ||
        submittedSession.workspaceToken !== selectionSession.workspaceToken ||
        submittedSession.revision !== selectionSession.revision
      )
        return
      const submittedLocalEditRevision = useEditorStore.getState().localEditRevision
      const id = crypto.randomUUID()
      setImportState({
        id,
        workspaceToken: submittedSession.workspaceToken,
        revision: submittedSession.revision,
        displayName: selection.displayName,
        stage: 'selected',
        percent: 0,
      })
      setError(null)
      try {
        const imported = await window.electronAPI.audio.startImport({
          workspaceToken: submittedSession.workspaceToken,
          revision: submittedSession.revision,
          jobId: id,
          selectionToken: selection.token,
          mode,
          draft: submittedDraft,
        })
        const latestSession = useEditorStore.getState().session
        if (
          imported.jobId === id &&
          imported.workspaceToken === submittedSession.workspaceToken &&
          imported.revision === submittedSession.revision &&
          latestSession?.workspaceToken === imported.workspaceToken &&
          latestSession.revision === imported.revision
        ) {
          await loadSession(imported.value, {
            submittedDraft,
            submittedLocalEditRevision,
          })
        }
      } catch (reason) {
        setError((reason as Error).message)
      } finally {
        setImportState(null)
      }
    },
    [importState, loadSession, snapshot],
  )

  const cancelImport = useCallback(async () => {
    if (!importState) return
    await window.electronAPI.audio.cancelImport({
      workspaceToken: importState.workspaceToken,
      revision: importState.revision,
      jobId: importState.id,
    })
  }, [importState])

  const openProject = useCallback(async () => {
    const current = useEditorStore.getState().session
    if (!current) return
    const result = await window.electronAPI.project.openDialog(current)
    if (result) await loadSession(result)
  }, [loadSession])

  const generateTranscript = useCallback(
    async (trackId?: string) => {
      const track =
        useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId) ??
        useTimelineStore.getState().tracks[0]
      const sourceId = track?.clips[0]?.audioSourceId
      const currentSession = useEditorStore.getState().session
      if (!track || !sourceId || !currentSession) return
      const jobId = crypto.randomUUID() as TranscriptionJobId
      const job = {
        jobId,
        workspaceToken: currentSession.workspaceToken,
        revision: currentSession.revision,
      }
      transcriptJob.current = job
      useTranscriptStore.getState().setIsGenerating(true)
      useTranscriptStore.getState().setGeneratingStatus('')
      setError(null)
      try {
        const generated = await window.electronAPI.transcript.generate({
          workspaceToken: currentSession.workspaceToken,
          revision: currentSession.revision,
          jobId,
          audioSourceId: sourceId,
        })
        const latest = useEditorStore.getState().session
        if (
          !transcriptJobMatches(transcriptJob.current, generated) ||
          !transcriptJobMatches(job, generated) ||
          !sessionMatchesTranscriptJob(latest, job)
        )
          return
        const currentTrack = useTimelineStore
          .getState()
          .tracks.find((candidate) => candidate.id === track.id)
        if (!currentTrack?.clips.some((clip) => clip.audioSourceId === sourceId)) return
        const incoming: Word[] = generated.value.words.map((word) => ({
          ...word,
          audioSourceId: sourceId,
          trackId: track.id,
        }))
        const latestTranscript = useTranscriptStore.getState()
        const merged = mergeTrackWords(latestTranscript.words, incoming, track.id, sourceId)
        latestTranscript.setWords(merged)
        latestTranscript.ensureTrackVisible(track.id)
        markEdited()
      } catch (reason) {
        if (
          transcriptJobMatches(transcriptJob.current, job) &&
          sessionMatchesTranscriptJob(useEditorStore.getState().session, job)
        )
          setError((reason as Error).message)
      } finally {
        if (
          transcriptJobMatches(transcriptJob.current, job) &&
          sessionMatchesTranscriptJob(useEditorStore.getState().session, job)
        ) {
          transcriptJob.current = null
          useTranscriptStore.getState().setIsGenerating(false)
          useTranscriptStore.getState().setGeneratingStatus('')
        }
      }
    },
    [markEdited],
  )

  const primarySource = session?.sources[0]
  const projectDuration = tracks
    .flatMap((track) => track.clips)
    .reduce(
      (maximum, clip) => Math.max(maximum, clip.outputStart + clip.sourceEnd - clip.sourceStart),
      0,
    )
  const exportDraft = showExport ? snapshot() : null

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
          {session ? ` — ${session.workspace.displayName}` : ''}
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
            disabled={!tracks.length}
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
      {showExport && exportDraft && session ? (
        <ExportModal session={session} draft={exportDraft} onClose={() => setShowExport(false)} />
      ) : null}
    </div>
  )
}

function transcriptJobMatches(
  active: TranscriptJobIdentity | null,
  candidate: TranscriptJobIdentity,
): boolean {
  return (
    active?.jobId === candidate.jobId &&
    active.workspaceToken === candidate.workspaceToken &&
    active.revision === candidate.revision
  )
}

function sessionMatchesTranscriptJob(
  session: SessionPrecondition | null,
  job: SessionPrecondition,
): boolean {
  return session?.workspaceToken === job.workspaceToken && session.revision === job.revision
}
