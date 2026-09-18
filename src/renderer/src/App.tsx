import { AudioPreparationProgress } from './components/audio-preparation/AudioPreparationProgress'
import { usePreparationProgressStore } from './stores/PreparationProgressStore'
import { MissingMediaDialog } from './components/project/MissingMediaDialog'
import { useMediaRecoveryStore } from './stores/MediaRecoveryStore'
import type { SpeechTaskSelection } from '@shared/SpeechTaskPlanner'
import { saveSpeakerIdentities } from './actions/SpeakerIdentityActions'
import { useSpeechBatchStore } from './stores/speechBatch.store'
import type { PublicMessage } from '@shared/publicMessages'
import { normalizePublicError, publicMessage } from './i18n/messages'
import { useTranslation } from './i18n/useTranslation'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { OnboardingDialog } from './components/onboarding/OnboardingDialog'
import { useLocaleStore } from './stores/locale.store'
import { LocaleNotice } from './components/LocaleNotice'
import { attachRedactionPreview } from './actions/playbackActions'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioSourceId } from '@shared/project.types'
import type { ImportMode } from '@shared/import.types'
import type {
  OpenProjectRequest,
  OpenProjectResult,
  ProjectDraft,
  RendererSession,
  SessionPrecondition,
  WorkspaceToken,
} from '@shared/session.types'
import type { SpeechAnalysisJobId } from '@shared/ipc.types'
import { setAudioPlayerInstance, type IAudioPlayer } from '@shared/player.types'
import { WorkletAudioPlayer } from './audio/WorkletAudioPlayer'
import { ContinuousPcmSampleProvider } from './audio/samples/ContinuousPcmSampleProvider'
import { BinaryWaveformDataProvider } from './components/Waveform/BinaryWaveformDataProvider'
import type { WaveformDataProvider } from './components/Waveform/WaveformDataProvider'
import { WaveformView } from './components/Waveform/WaveformView'
import { FileInfoPanel } from './components/FileInfoPanel'
import { EditorWorkspace } from './components/Workspace/EditorWorkspace'
import { TransportBar } from './components/Transport/TransportBar'
import { TranscriptPanel } from './components/Transcript/TranscriptPanel'
import { ExportModal } from './components/Export/ExportModal'
import { Icon } from './components/ui/Icon'
import { Button } from './components/ui/Button'
import { useEditorStore } from './stores/editor.store'
import { usePlaybackStore } from './stores/playback.store'
import { useTimelineStore } from './stores/timeline.store'
import { useTranscriptStore } from './stores/transcript.store'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { createSessionLoadCoordinator, type SessionLoadCoordinator } from './sessionLoadCoordinator'
import { reconcileImportedSession } from './importSessionReconciler'

interface ImportState {
  id: string
  workspaceToken: WorkspaceToken
  revision: number
}

interface TranscriptJobIdentity extends SessionPrecondition {
  jobId: SpeechAnalysisJobId
}

interface PreparedRendererSession {
  player: IAudioPlayer
  subscriptions: (() => void)[]
  waveforms: ReadonlyMap<AudioSourceId, WaveformDataProvider>
}

interface RendererSessionLoad {
  session: RendererSession
  retainVisibleEditorState?: boolean
  importLedger?: {
    submittedDraft: ProjectDraft
    submittedLocalEditRevision: number
  }
}

interface OpenOperationLedger {
  startingSession: RendererSession
  visibleDraft: ProjectDraft
  wasDirty: boolean
  localEditRevision: number
}

type OpenOperationDescriptor =
  | { kind: 'manual' }
  | { kind: 'pending'; requestId: string }
  | { kind: 'starter'; starterKind: 'sample' | 'empty'; onOutcome: (switched: boolean) => void }

interface QueuedOpenOperation {
  descriptor: OpenOperationDescriptor
  resolve: () => void
  reject: (reason: unknown) => void
}

function snapshotDraft(): ProjectDraft | null {
  const current = useEditorStore.getState().session
  if (!current) return null
  return {
    tracks: useTimelineStore.getState().tracks,
    export: current.draft.export,
  }
}

export default function App() {
  const { t } = useTranslation()
  const [waveforms, setWaveforms] = useState<ReadonlyMap<AudioSourceId, WaveformDataProvider>>(
    new Map(),
  )
  const [importState, setImportState] = useState<ImportState | null>(null)
  const [error, setError] = useState<PublicMessage | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const showOnboarding = useLocaleStore(
    (state) => state.hydrated && state.onboardingDisposition === 'pending',
  )
  const playerRef = useRef<IAudioPlayer | null>(null)
  const playerSubscriptions = useRef<(() => void)[]>([])
  const initialized = useRef(false)
  const transcriptJob = useRef<TranscriptJobIdentity | null>(null)
  const observedBackgroundTracks = useRef<{
    workspaceToken: WorkspaceToken
    ids: Set<string>
  } | null>(null)
  const cancelledTranscriptJob = useRef<TranscriptJobIdentity | null>(null)
  const importJob = useRef<(SessionPrecondition & { jobId: string }) | null>(null)
  const loadCoordinator = useRef<SessionLoadCoordinator<RendererSessionLoad> | null>(null)
  const lastSwitchTransition = useRef<string | null>(null)
  const suspendedSession = useRef<SessionPrecondition | null>(null)
  const openQueue = useRef<QueuedOpenOperation[]>([])
  const processingOpenQueue = useRef(false)
  const manualOpenPromise = useRef<Promise<void> | null>(null)
  const activeOpenRequests = useRef(0)

  const session = useEditorStore((state) => state.session)
  const isDirty = useEditorStore((state) => state.isDirty)
  const loadEditorSession = useEditorStore((state) => state.loadSession)
  const acknowledgeSave = useEditorStore((state) => state.acknowledgeSave)
  const tracks = useTimelineStore((state) => state.tracks)
  const isGenerating = useSpeechBatchStore((state) => state.isGenerating)
  const generatingStatus = useSpeechBatchStore((state) => state.generatingStatus)

  const destroyPlayer = useCallback(async (): Promise<void> => {
    const player = playerRef.current
    playerRef.current = null
    setAudioPlayerInstance(null)
    playerSubscriptions.current.splice(0).forEach((unsubscribe) => unsubscribe())
    if (!player) return
    player.pause()
    await player.destroy()
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
              player.onError((playbackError) => setError(normalizePublicError(playbackError))),
              attachRedactionPreview(player),
            ],
          }
        } catch (error) {
          await player.destroy()
          throw error
        }
      },
      async (request, prepared, isCurrent) => {
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
        await destroyPlayer()
        if (!isCurrent()) return
        usePlaybackStore.getState().reset()
        if (request.retainVisibleEditorState) {
          useTimelineStore.getState().refreshAudioSources(result.sources)
        } else {
          useTimelineStore.getState().loadFromProject(result.sources, result.draft.tracks)
          useTranscriptStore.getState().reset()
        }
        useTranscriptStore.getState().loadAnalyses(result.speechAnalyses)
        playerSubscriptions.current = prepared.subscriptions
        usePlaybackStore.getState().setDuration(prepared.player.getDuration())
        playerRef.current = prepared.player
        setAudioPlayerInstance(prepared.player)
        loadEditorSession(result, request.retainVisibleEditorState || preserveDirty)
        setWaveforms(prepared.waveforms)
        setError(null)
      },
      async (prepared) => {
        prepared.subscriptions.forEach((unsubscribe) => unsubscribe())
        await prepared.player.destroy()
      },
    )
  }

  const invalidateTranscriptJob = useCallback(() => {
    transcriptJob.current = null
    useSpeechBatchStore.getState().reset()
  }, [])

  const invalidateImportJob = useCallback(() => {
    if (importJob.current) usePreparationProgressStore.getState().end(importJob.current.jobId)
    importJob.current = null
    setImportState(null)
  }, [])

  const invalidateImportJobForSession = useCallback(
    (appliedSession: SessionPrecondition | null) => {
      if (importJob.current && !sessionMatchesTranscriptJob(appliedSession, importJob.current))
        invalidateImportJob()
    },
    [invalidateImportJob],
  )

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
    (
      result: RendererSession,
      importLedger?: RendererSessionLoad['importLedger'],
      retainVisibleEditorState = false,
    ) => {
      if (useEditorStore.getState().session?.workspaceToken !== result.workspaceToken)
        useSpeechBatchStore.getState().reset()
      invalidateTranscriptJobForSession(result)
      invalidateImportJobForSession(result)
      return loadCoordinator.current!.load({
        session: result,
        retainVisibleEditorState,
        importLedger,
      })
    },
    [invalidateImportJobForSession, invalidateTranscriptJobForSession],
  )

  useEffect(
    () => window.electronAPI.on.mediaRecoveryChanged(useMediaRecoveryStore.getState().receive),
    [],
  )

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void window.electronAPI.project
      .initialize()
      .then(loadSession)
      .catch((reason: unknown) => {
        setError(normalizePublicError(reason))
      })
    return () => {
      const invalidation = loadCoordinator.current?.invalidate() ?? Promise.resolve()
      void Promise.allSettled([invalidation, destroyPlayer()])
    }
  }, [destroyPlayer, loadSession])

  useEffect(
    () =>
      window.electronAPI.on.importProgress((progress) => {
        const editorSession = useEditorStore.getState().session
        if (
          importJobMatches(importJob.current, progress) &&
          sessionMatchesTranscriptJob(editorSession, progress)
        )
          usePreparationProgressStore.getState().receiveImport(progress)
      }),
    [],
  )

  useEffect(
    () =>
      window.electronAPI.on.projectOpenProgress((event) => {
        usePreparationProgressStore.getState().receiveOpen(event)
      }),
    [],
  )

  const applyBackgroundSession = useCallback(
    async (incoming: RendererSession, submittedDraft: ProjectDraft) => {
      const player = playerRef.current
      const before = useEditorStore.getState().session
      if (!before || before.workspaceToken !== incoming.workspaceToken) return
      for (const source of incoming.sources) {
        if (!before.sources.some((existing) => existing.id === source.id)) {
          await player?.registerAudioSource(
            source.id,
            new ContinuousPcmSampleProvider(source.cache),
          )
        }
      }
      const latest = useEditorStore.getState().session
      if (
        !latest ||
        latest.workspaceToken !== incoming.workspaceToken ||
        player !== playerRef.current
      )
        return
      if (incoming.revision < latest.revision) return
      const visible = snapshotDraft()!
      if (observedBackgroundTracks.current?.workspaceToken !== incoming.workspaceToken)
        observedBackgroundTracks.current = {
          workspaceToken: incoming.workspaceToken,
          ids: new Set(),
        }
      const submittedIds = observedBackgroundTracks.current.ids
      for (const track of [...submittedDraft.tracks, ...latest.draft.tracks])
        submittedIds.add(track.id)
      const visibleIds = new Set(visible.tracks.map((track) => track.id))
      const additions = incoming.draft.tracks.filter(
        (track) => !submittedIds.has(track.id) && !visibleIds.has(track.id),
      )
      for (const track of incoming.draft.tracks) submittedIds.add(track.id)
      useTimelineStore.getState().appendImportedTracks(additions)
      const mergedTracks = useTimelineStore.getState().tracks
      const published = { ...incoming, draft: { ...visible, tracks: mergedTracks } }
      useTimelineStore.getState().refreshAudioSources(published.sources)
      useTranscriptStore.getState().loadAnalyses(published.speechAnalyses)
      loadEditorSession(published, true)
      player?.setTracks(mergedTracks)
      setWaveforms((previous) => {
        const next = new Map(previous)
        for (const source of published.sources)
          if (!next.has(source.id))
            next.set(source.id, new BinaryWaveformDataProvider(source.cache))
        return next
      })
    },
    [loadEditorSession],
  )

  const speechDraft = useRef<ProjectDraft | null>(null)
  useEffect(
    () =>
      window.electronAPI.on.speechAnalysisProgress((progress) => {
        const current = useEditorStore.getState().session
        if (
          !transcriptJobMatches(transcriptJob.current, progress) ||
          !sessionMatchesTranscriptJob(current, progress)
        )
          return
        useSpeechBatchStore.getState().update(
          {
            stage: progress.stage,
            percent: progress.percent,
            stageStartedAtMs: progress.stageStartedAtMs,
            estimatedDurationMs: progress.estimatedDurationMs,
          },
          progress.batch,
        )
        if (progress.session && speechDraft.current)
          void applyBackgroundSession(progress.session, speechDraft.current).catch(
            (reason: unknown) => {
              if (
                transcriptJobMatches(transcriptJob.current, progress) &&
                sessionMatchesTranscriptJob(useEditorStore.getState().session, progress)
              )
                setError(normalizePublicError(reason))
            },
          )
      }),
    [applyBackgroundSession],
  )

  const applyOpenResult = useCallback(
    async (result: OpenProjectResult, ledger: OpenOperationLedger) => {
      const current = useEditorStore.getState().session
      const requiresResume = sameSession(suspendedSession.current, result.session)
      if (
        current?.workspaceToken === result.session.workspaceToken &&
        current.revision === result.session.revision &&
        !requiresResume
      ) {
        setError(openResultMessage(result))
        return
      }
      let sessionToLoad = result.session
      let retainVisibleEditorState = false
      if (result.outcome === 'stayed') {
        const saveAdvancedRollback = !sameSession(ledger.startingSession, result.session)
        const latestState = useEditorStore.getState()
        const visibleStillBelongsToStartingSession = sameSession(
          latestState.session,
          ledger.startingSession,
        )
        const latestDraft = visibleStillBelongsToStartingSession
          ? (snapshotDraft() ?? ledger.visibleDraft)
          : ledger.visibleDraft
        const hasLaterEdits =
          visibleStillBelongsToStartingSession &&
          latestState.localEditRevision > ledger.localEditRevision
        if (!saveAdvancedRollback || hasLaterEdits) {
          sessionToLoad = { ...result.session, draft: latestDraft }
          retainVisibleEditorState = true
        }
      }
      await loadSession(sessionToLoad, undefined, retainVisibleEditorState)
      suspendedSession.current = null
      setError(openResultMessage(result))
    },
    [loadSession],
  )

  const captureOpenOperation = useCallback((): {
    request: OpenProjectRequest
    ledger: OpenOperationLedger
  } | null => {
    const current = useEditorStore.getState().session
    if (!current) return null
    const visibleDraft = snapshotDraft()
    if (!visibleDraft) return null
    const editor = useEditorStore.getState()
    const operationId = crypto.randomUUID()
    const ledger = {
      startingSession: current,
      visibleDraft,
      wasDirty: editor.isDirty,
      localEditRevision: editor.localEditRevision,
    }
    if (!editor.isDirty)
      return {
        ledger,
        request: {
          operationId,
          workspaceToken: current.workspaceToken,
          revision: current.revision,
          isDirty: false,
        },
      }
    return {
      ledger,
      request: {
        operationId,
        workspaceToken: current.workspaceToken,
        revision: current.revision,
        isDirty: true,
        draft: visibleDraft,
      },
    }
  }, [])

  useEffect(
    () =>
      window.electronAPI.on.projectWillSwitch(async (event) => {
        const current = useEditorStore.getState().session
        const matchesVisibleSession =
          current?.workspaceToken === event.workspaceToken && current.revision === event.revision
        if (
          !current ||
          (!matchesVisibleSession && activeOpenRequests.current === 0) ||
          lastSwitchTransition.current === event.transitionId
        )
          return
        lastSwitchTransition.current = event.transitionId
        suspendedSession.current = event
        invalidateTranscriptJob()
        invalidateImportJob()
        importJob.current = null
        setImportState(null)
        setShowExport(false)
        try {
          await (loadCoordinator.current?.invalidate() ?? Promise.resolve())
          await destroyPlayer()
          usePlaybackStore.getState().reset()
          await window.electronAPI.project.acknowledgeSwitch(event)
        } catch (reason) {
          setError(normalizePublicError(reason))
        }
      }),
    [destroyPlayer, invalidateImportJob, invalidateTranscriptJob],
  )

  const drainOpenQueue = useCallback(async () => {
    if (processingOpenQueue.current) return
    processingOpenQueue.current = true
    try {
      while (openQueue.current.length > 0) {
        const captured = captureOpenOperation()
        if (!captured) return
        const operation = openQueue.current.shift()!
        activeOpenRequests.current += 1
        usePreparationProgressStore.getState().beginOpen(captured.request.operationId)
        try {
          const result =
            operation.descriptor.kind === 'manual'
              ? await window.electronAPI.project.openDialog(captured.request)
              : operation.descriptor.kind === 'starter'
                ? await window.electronAPI.project.openStarter(
                    captured.request,
                    operation.descriptor.starterKind,
                  )
                : await window.electronAPI.project.openPending({
                    ...captured.request,
                    requestId: operation.descriptor.requestId,
                  })
          if (
            result.outcome === 'switched' ||
            sameSession(suspendedSession.current, result.session)
          )
            usePreparationProgressStore.getState().prepareEditor(captured.request.operationId)
          await applyOpenResult(result, captured.ledger)
          if (operation.descriptor.kind === 'starter')
            operation.descriptor.onOutcome(result.outcome === 'switched')
          operation.resolve()
        } catch (reason) {
          setError(normalizePublicError(reason))
          operation.reject(reason)
        } finally {
          usePreparationProgressStore.getState().end(captured.request.operationId)
          activeOpenRequests.current -= 1
          if (operation.descriptor.kind === 'manual') manualOpenPromise.current = null
        }
      }
    } finally {
      processingOpenQueue.current = false
    }
  }, [applyOpenResult, captureOpenOperation])

  const enqueueOpen = useCallback(
    (descriptor: OpenOperationDescriptor): Promise<void> => {
      if (descriptor.kind === 'manual' && manualOpenPromise.current)
        return manualOpenPromise.current
      const queued = new Promise<void>((resolve, reject) => {
        openQueue.current.push({ descriptor, resolve, reject })
      })
      if (descriptor.kind === 'manual') manualOpenPromise.current = queued
      void drainOpenQueue()
      return queued
    },
    [drainOpenQueue],
  )

  useEffect(
    () =>
      window.electronAPI.on.pendingProjectOpen(async ({ requestId }) => {
        try {
          await enqueueOpen({ kind: 'pending', requestId })
        } catch {
          // The queue already exposed the sanitized failure and must continue with later items.
        }
      }),
    [enqueueOpen],
  )

  useEffect(() => {
    if (session) void drainOpenQueue()
  }, [drainOpenQueue, session])

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
        if (!sameSession(useEditorStore.getState().session, currentSession)) return
        acknowledgeSave(saved, capturedLocalEditRevision)
        invalidateTranscriptJobForSession(useEditorStore.getState().session)
        invalidateImportJobForSession(useEditorStore.getState().session)
        setError(null)
      } catch (reason) {
        if (sameSession(useEditorStore.getState().session, currentSession))
          setError(normalizePublicError(reason))
      }
    },
    [acknowledgeSave, invalidateImportJobForSession, invalidateTranscriptJobForSession, snapshot],
  )

  useKeyboardShortcuts({
    onSave: importState ? undefined : () => void save(false),
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
        submittedSession.workspaceToken !== selectionSession.workspaceToken
      )
        return
      const id = crypto.randomUUID()
      setImportState({
        id,
        workspaceToken: submittedSession.workspaceToken,
        revision: submittedSession.revision,
      })
      importJob.current = {
        jobId: id,
        workspaceToken: submittedSession.workspaceToken,
        revision: submittedSession.revision,
      }
      usePreparationProgressStore.getState().beginImport(importJob.current, selection.displayName)
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
        const identity = {
          jobId: id,
          workspaceToken: submittedSession.workspaceToken,
          revision: submittedSession.revision,
        }
        if (
          importJobMatches(importJob.current, identity) &&
          importJobMatches(imported, identity) &&
          latestSession?.workspaceToken === imported.workspaceToken
        ) {
          usePreparationProgressStore.getState().prepareEditor(id)
          await applyBackgroundSession(imported.value, submittedDraft)
        }
      } catch (reason) {
        const identity = {
          jobId: id,
          workspaceToken: submittedSession.workspaceToken,
          revision: submittedSession.revision,
        }
        if (
          importJobMatches(importJob.current, identity) &&
          sessionMatchesTranscriptJob(useEditorStore.getState().session, identity)
        )
          setError(normalizePublicError(reason))
      } finally {
        const identity = {
          jobId: id,
          workspaceToken: submittedSession.workspaceToken,
          revision: submittedSession.revision,
        }
        if (
          importJobMatches(importJob.current, identity) &&
          sessionMatchesTranscriptJob(useEditorStore.getState().session, identity)
        )
          invalidateImportJob()
      }
    },
    [importState, invalidateImportJob, applyBackgroundSession, snapshot],
  )

  const cancelImport = useCallback(async () => {
    if (!importState) return
    const progress = usePreparationProgressStore.getState()
    if (progress.importing?.id !== importState.id || !progress.importing.canCancel) return
    progress.cancelling(importState.id)
    try {
      await window.electronAPI.audio.cancelImport({
        workspaceToken: importState.workspaceToken,
        revision: importState.revision,
        jobId: importState.id,
      })
    } catch (reason) {
      usePreparationProgressStore.getState().cancelFailed(importState.id)
      throw reason
    }
  }, [importState])

  const openProject = useCallback(async () => {
    await enqueueOpen({ kind: 'manual' })
  }, [enqueueOpen])

  const generateTranscript = useCallback(
    async (
      trackId?: string,
      tasks: SpeechTaskSelection = { text: 'missing', speakers: 'missing' },
    ) => {
      const selectedTracks = useTimelineStore
        .getState()
        .tracks.filter((track) => trackId === undefined || track.id === trackId)
      const sourceIds = new Set(
        selectedTracks.flatMap((track) => track.clips.map((clip) => clip.audioSourceId)),
      )
      const currentSession = useEditorStore.getState().session
      if (!sourceIds.size || !currentSession || transcriptJob.current) return
      const jobId = crypto.randomUUID() as SpeechAnalysisJobId
      const job = {
        jobId,
        workspaceToken: currentSession.workspaceToken,
        revision: currentSession.revision,
      }
      transcriptJob.current = job
      useSpeechBatchStore.getState().begin()
      setError(null)
      try {
        const draft = snapshotDraft()
        if (!draft) return
        speechDraft.current = draft
        const resetsLabels =
          (tasks.text === 'replace' || tasks.speakers === 'replace') &&
          useTranscriptStore
            .getState()
            .analyses.some(
              (analysis) =>
                sourceIds.has(analysis.audioSourceId) && analysis.speakerLabelOverrides.length > 0,
            )
        const confirmSpeakerLabelReset =
          resetsLabels && window.confirm(t('dialogs.resetSpeakerNames'))
        if (resetsLabels && !confirmSpeakerLabelReset) return
        const unavailable = await window.electronAPI.speechAnalysis.checkAvailability(tasks)
        if (
          transcriptJobMatches(cancelledTranscriptJob.current, job) ||
          !transcriptJobMatches(transcriptJob.current, job) ||
          !sessionMatchesTranscriptJob(useEditorStore.getState().session, job)
        )
          return
        if (unavailable) throw unavailable
        const generated = await window.electronAPI.speechAnalysis.start({
          workspaceToken: currentSession.workspaceToken,
          revision: currentSession.revision,
          jobId,
          scope: trackId === undefined ? { kind: 'all' } : { kind: 'track', trackId },
          tasks,
          language: 'auto',
          draft,
          ...(confirmSpeakerLabelReset ? { confirmSpeakerLabelReset: true } : {}),
        })
        const latest = useEditorStore.getState().session
        if (
          !transcriptJobMatches(transcriptJob.current, generated) ||
          !transcriptJobMatches(job, generated) ||
          !sessionMatchesTranscriptJob(latest, job)
        )
          return
        await applyBackgroundSession(generated.value, draft)
        if (
          !transcriptJobMatches(transcriptJob.current, job) ||
          !sessionMatchesTranscriptJob(useEditorStore.getState().session, job)
        )
          return
        useSpeechBatchStore.getState().finish(generated.batch)
      } catch (reason) {
        if (
          transcriptJobMatches(transcriptJob.current, job) &&
          sessionMatchesTranscriptJob(useEditorStore.getState().session, job)
        )
          if (transcriptJobMatches(cancelledTranscriptJob.current, job))
            useSpeechBatchStore.getState().finishCancelled()
          else setError(normalizePublicError(reason))
      } finally {
        if (transcriptJobMatches(transcriptJob.current, job)) {
          transcriptJob.current = null
          if (useSpeechBatchStore.getState().isGenerating) useSpeechBatchStore.getState().finish()
        }
      }
    },
    [applyBackgroundSession, t],
  )

  const cancelSpeechAnalysis = useCallback(() => {
    const job = transcriptJob.current
    if (!job) return
    cancelledTranscriptJob.current = job
    void window.electronAPI.speechAnalysis.cancel(job).catch((reason: unknown) => {
      if (
        transcriptJobMatches(transcriptJob.current, job) &&
        sessionMatchesTranscriptJob(useEditorStore.getState().session, job)
      )
        setError(normalizePublicError(reason))
    })
  }, [])

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
      data-redencut-session-ready={Boolean(session)}
      data-redencut-dirty={isDirty}
      data-redencut-busy={Boolean(importState) || isGenerating}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-primary)',
      }}
    >
      <header className="project-header">
        <div className="project-identity">
          <span
            className="project-name"
            title={
              session?.workspace.kind === 'saved'
                ? session.workspace.displayName
                : t('app.untitled')
            }
          >
            {session?.workspace.kind === 'saved'
              ? session.workspace.displayName
              : t('app.untitled')}
          </span>
        </div>
        <div className="project-actions">
          <span className="project-save-state">
            <i data-dirty={isDirty} />
            {isDirty ? t('app.unsaved') : t('app.saved')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() =>
              void openProject().catch((reason: unknown) => setError(normalizePublicError(reason)))
            }
          >
            {t('app.openProject')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() => void save(false)}
          >
            {t('common.save')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(importState)}
            onClick={() => void save(true)}
          >
            {t('app.saveAs')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowExport(true)}
            disabled={!tracks.length}
          >
            <Icon name="upload" /> {t('export.title')}
          </Button>
        </div>
      </header>

      <LocaleNotice />
      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            color: 'var(--color-danger)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          {publicMessage(t, error)}
        </div>
      )}
      <AudioPreparationProgress
        onCancel={() =>
          void cancelImport().catch((reason: unknown) => setError(normalizePublicError(reason)))
        }
      />

      <EditorWorkspace
        audio={(workspaceControls) => (
          <WaveformView
            workspaceControls={workspaceControls}
            audioDetails={
              primarySource ? (
                <FileInfoPanel
                  displayName={primarySource.displayName}
                  metadata={primarySource.metadata}
                />
              ) : null
            }
            duration={projectDuration}
            providersBySource={waveforms}
            onAddTrack={() =>
              void importAudio('copy').catch((reason: unknown) =>
                setError(normalizePublicError(reason)),
              )
            }
            isImporting={Boolean(importState)}
          />
        )}
        transcript={(workspaceControls) => (
          <TranscriptPanel
            onSaveSpeakerIdentities={(expected, next) =>
              saveSpeakerIdentities(expected, next, async (updated) => {
                const draft = snapshotDraft()
                if (draft) await applyBackgroundSession(updated, draft)
              })
            }
            workspaceControls={workspaceControls}
            onGenerate={(trackId) => void generateTranscript(trackId)}
            onRun={(scope, tasks) =>
              void generateTranscript(scope.kind === 'track' ? scope.trackId : undefined, tasks)
            }
            isGenerating={isGenerating}
            generatingStatus={generatingStatus}
            onCancel={cancelSpeechAnalysis}
          />
        )}
        transport={(workspaceControls) => (
          <TransportBar
            workspaceControls={workspaceControls}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      />
      <MissingMediaDialog />
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showOnboarding && (
        <OnboardingDialog
          onStart={async (starterKind) => {
            let switched = false
            await enqueueOpen({
              kind: 'starter',
              starterKind,
              onOutcome: (value) => {
                switched = value
              },
            })
            return switched
          }}
        />
      )}
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
  return session?.workspaceToken === job.workspaceToken
}

function importJobMatches(
  active: (SessionPrecondition & { jobId: string }) | null,
  candidate: SessionPrecondition & { jobId: string },
): boolean {
  return (
    active?.jobId === candidate.jobId &&
    active.workspaceToken === candidate.workspaceToken &&
    active.revision === candidate.revision
  )
}

function openResultMessage(result: OpenProjectResult): PublicMessage | null {
  if (result.outcome === 'switched' || result.reason === 'cancelled') return null
  return { reason: result.reason }
}

function sameSession(left: SessionPrecondition | null, right: SessionPrecondition): boolean {
  return left?.workspaceToken === right.workspaceToken && left.revision === right.revision
}
