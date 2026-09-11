// @vitest-environment jsdom

import React from 'react'
import { useWorkspaceStore } from './stores/workspace.store'
import { DEFAULT_WORKSPACE_LAYOUT } from '@shared/workspaceLayout.types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IElectronAPI, SessionJobResult, SpeechAnalysisJobId } from '@shared/ipc.types'
import type { AudioSourceId, Track } from '@shared/project.types'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from './stores/editor.store'
import { useTimelineStore } from './stores/timeline.store'
import { usePlaybackStore } from './stores/playback.store'
import { useTranscriptStore } from './stores/transcript.store'

const mocks = vi.hoisted(() => ({
  registerAudioSource: vi.fn(async (_id?: unknown, _provider?: unknown): Promise<void> => {}),
  destroyPlayer: vi.fn(async (): Promise<void> => {}),
  players: [] as Array<{ pause: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>,
  keyboardSave: undefined as (() => void) | undefined,
}))

vi.mock('./audio/WorkletAudioPlayer', () => ({
  WorkletAudioPlayer: class {
    constructor() {
      mocks.players.push(this)
    }
    registerAudioSource = mocks.registerAudioSource
    pause = vi.fn()
    duration = 10
    durationCallbacks: ((duration: number) => void)[] = []
    setTracks = vi.fn((tracks: Track[]) => {
      this.duration = tracks
        .flatMap((track) => track.clips)
        .reduce(
          (end, clip) => Math.max(end, clip.outputStart + clip.sourceEnd - clip.sourceStart),
          0,
        )
      this.durationCallbacks.forEach((callback) => callback(this.duration))
    })
    getDuration = vi.fn(() => this.duration)
    onTimeUpdate = vi.fn(() => vi.fn())
    onPlayStateChange = vi.fn(() => vi.fn())
    onDurationChange = vi.fn((callback: (duration: number) => void) => {
      this.durationCallbacks.push(callback)
      return () => {
        this.durationCallbacks = this.durationCallbacks.filter((entry) => entry !== callback)
      }
    })
    onEnded = vi.fn(() => vi.fn())
    onError = vi.fn(() => vi.fn())
    destroy = vi.fn(() => mocks.destroyPlayer())
  },
}))
vi.mock('./audio/samples/ContinuousPcmSampleProvider', () => ({
  ContinuousPcmSampleProvider: class {},
}))
vi.mock('./components/Waveform/BinaryWaveformDataProvider', () => ({
  BinaryWaveformDataProvider: class {},
}))
vi.mock('./components/Waveform/WaveformView', () => ({
  WaveformView: ({ workspaceControls }: { workspaceControls?: React.ReactNode }) => (
    <div data-testid="waveform">{workspaceControls}</div>
  ),
}))
vi.mock('./components/FileInfoPanel', () => ({ FileInfoPanel: () => null }))
vi.mock('./components/Transport/TransportBar', () => ({
  TransportBar: ({ workspaceControls }: { workspaceControls?: React.ReactNode }) => (
    <div>{workspaceControls}</div>
  ),
}))
vi.mock('./components/Export/ExportModal', () => ({ ExportModal: () => null }))
vi.mock('./hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: ({ onSave }: { onSave?: () => void }) => {
    mocks.keyboardSave = onSave
  },
}))
vi.mock('./components/Transcript/TranscriptPanel', () => ({
  TranscriptPanel: ({
    workspaceControls,
    onGenerate,
    isGenerating,
    generatingStatus,
  }: {
    workspaceControls?: React.ReactNode
    onGenerate: (trackId: string) => void
    isGenerating: boolean
    generatingStatus: string
  }) => (
    <div>
      {workspaceControls}
      <button onClick={() => onGenerate('track-1')}>Generate transcript</button>
      <span data-testid="generation-state">
        {String(isGenerating)}:{generatingStatus}
      </span>
    </div>
  ),
}))

import App from './App'

const SOURCE_A = '00000000-0000-4000-8000-000000000001' as AudioSourceId
const SOURCE_B = '00000000-0000-4000-8000-000000000002' as AudioSourceId
const TOKEN_A = 'workspace-a' as WorkspaceToken
const TOKEN_B = 'workspace-b' as WorkspaceToken

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function session(
  workspaceToken: WorkspaceToken,
  revision: number,
  sourceId: AudioSourceId,
  displayName: string,
): RendererSession {
  const clip = {
    id: `clip-${displayName}`,
    trackId: 'track-1',
    audioSourceId: sourceId,
    sourceStart: 0,
    sourceEnd: 10,
    outputStart: 0,
    gain: 1,
    muted: false,
    effects: [],
  }
  return {
    workspaceToken,
    revision,
    workspace: { kind: 'saved', displayName, portable: true },
    sources: [
      {
        id: sourceId,
        displayName: `${displayName}.wav`,
        metadata: {
          durationSeconds: 10,
          sampleRate: 48_000,
          channels: 1,
          codec: 'wav',
          bitrateKbps: 768,
        },
        cache: {
          audioSourceId: sourceId,
          sampleRate: 48_000,
          channels: 1,
          frameCount: 480_000,
          waveformLevels: [],
        },
      },
    ],
    speechAnalyses: [],
    draft: {
      tracks: [
        {
          id: 'track-1',
          name: 'Primary',
          clips: [clip],
          volume: 1,
          muted: false,
          solo: false,
          color: '#fff',
          effects: [],
        },
        {
          id: 'track-2',
          name: 'Notes',
          clips: [],
          volume: 1,
          muted: false,
          solo: false,
          color: '#000',
          effects: [],
        },
      ],
      export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48_000 },
    },
  }
}

function installApi(initial: RendererSession) {
  let importProgress!: Parameters<IElectronAPI['on']['importProgress']>[0]
  let speechAnalysisProgress!: Parameters<IElectronAPI['on']['speechAnalysisProgress']>[0]
  let projectWillSwitch!: Parameters<IElectronAPI['on']['projectWillSwitch']>[0]
  let pendingProjectOpen!: Parameters<IElectronAPI['on']['pendingProjectOpen']>[0]
  const requests: Array<{
    request: Parameters<IElectronAPI['speechAnalysis']['start']>[0]
    deferred: ReturnType<typeof deferred<SessionJobResult<RendererSession, SpeechAnalysisJobId>>>
  }> = []
  const openDialog = vi.fn<IElectronAPI['project']['openDialog']>(async () => ({
    outcome: 'stayed',
    reason: 'cancelled',
    session: initial,
  }))
  const openPending = vi.fn<IElectronAPI['project']['openPending']>(async () => ({
    outcome: 'stayed',
    reason: 'cancelled',
    session: initial,
  }))
  const saveProject = vi.fn<IElectronAPI['project']['save']>(async () => null)
  const saveProjectAs = vi.fn<IElectronAPI['project']['saveAs']>(async () => null)
  const api = {
    workspaceLayout: {
      get: vi.fn<IElectronAPI['workspaceLayout']['get']>(async () => ({
        layout: DEFAULT_WORKSPACE_LAYOUT,
        warning: null,
      })),
      set: vi.fn<IElectronAPI['workspaceLayout']['set']>(),
    },
    project: {
      initialize: vi.fn(async () => initial),
      openDialog,
      openPending,
      acknowledgeSwitch: vi.fn(async () => true),
      save: saveProject,
      saveAs: saveProjectAs,
    },
    audio: {
      selectImportFile: vi.fn<IElectronAPI['audio']['selectImportFile']>(async () => null),
      startImport: vi.fn<IElectronAPI['audio']['startImport']>(),
      cancelImport: vi.fn(async () => 'not-found' as const),
    },
    transcript: {
      checkAvailability: vi.fn(async () => null),
      generate: vi.fn(),
      cancel: vi.fn(async () => 'not-found' as const),
    },
    speechAnalysis: {
      checkAvailability: vi.fn(async () => null),
      start: vi.fn((request) => {
        const pending = deferred<SessionJobResult<RendererSession, SpeechAnalysisJobId>>()
        requests.push({ request, deferred: pending })
        return pending.promise
      }),
      cancel: vi.fn(async () => 'not-found' as const),
    },
    speakerLabel: {
      rename: vi.fn(),
    },
    render: {
      startExport: vi.fn(),
      cancelExport: vi.fn(async () => 'not-found' as const),
    },
    on: {
      importProgress: vi.fn((callback) => {
        importProgress = callback
        return vi.fn()
      }),
      transcriptProgress: vi.fn((callback) => {
        void callback
        return vi.fn()
      }),
      speechAnalysisProgress: vi.fn((callback) => {
        speechAnalysisProgress = callback
        return vi.fn()
      }),
      renderProgress: vi.fn(() => vi.fn()),
      projectWillSwitch: vi.fn((callback) => {
        projectWillSwitch = callback
        return vi.fn()
      }),
      pendingProjectOpen: vi.fn((callback) => {
        pendingProjectOpen = callback
        return vi.fn()
      }),
    },
  } satisfies IElectronAPI
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  return {
    api,
    requests,
    importProgress: () => importProgress,
    progress: () => speechAnalysisProgress,
    willSwitch: () => projectWillSwitch,
    pendingOpen: () => pendingProjectOpen,
  }
}

async function renderInitialized(initial: RendererSession) {
  const installed = installApi(initial)
  render(<App />)
  await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A))
  return installed
}

describe('App transcription job identity', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useTimelineStore.getState().reset()
    useTranscriptStore.getState().reset()
    mocks.registerAudioSource.mockReset()
    mocks.registerAudioSource.mockResolvedValue(undefined)
    mocks.destroyPlayer.mockReset()
    mocks.destroyPlayer.mockResolvedValue(undefined)
    mocks.players.splice(0)
    mocks.keyboardSave = undefined
    useWorkspaceStore.setState({ layout: DEFAULT_WORKSPACE_LAYOUT })
    const ids = ['job-a', 'job-b', 'job-c']
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => ids.shift()! as `${string}-${string}-${string}-${string}-${string}`,
    )
  })

  it('keeps the active player, project state and timeline history when workspace panels move', async () => {
    const { api } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    const player = getAudioPlayerInstance()
    const editor = useEditorStore.getState()
    const timeline = useTimelineStore.getState()
    fireEvent.click(screen.getByRole('button', { name: 'Move Transcript down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Transport up' }))
    expect(getAudioPlayerInstance()).toBe(player)
    expect(mocks.players).toHaveLength(1)
    expect(mocks.destroyPlayer).not.toHaveBeenCalled()
    expect(useEditorStore.getState()).toBe(editor)
    expect(useTimelineStore.getState()).toBe(timeline)
    await waitFor(() => expect(api.workspaceLayout.set).toHaveBeenCalled())
  })

  it('applies the authoritative speech-analysis session without making analysis a local edit', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const published = session(TOKEN_A, 2, SOURCE_A, 'A')
    published.speechAnalyses = [{ audioSourceId: SOURCE_A } as never]
    const { requests, progress } = await renderInitialized(initial)

    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    act(() => progress()({ ...requests[0].request, stage: 'aligning', percent: 50 }))
    expect(useTranscriptStore.getState().generatingStatus).toBe('aligning')
    requests[0].deferred.resolve({
      jobId: requests[0].request.jobId,
      workspaceToken: requests[0].request.workspaceToken,
      revision: requests[0].request.revision,
      value: published,
    })

    await waitFor(() => expect(useEditorStore.getState().session?.revision).toBe(2))
    expect(requests[0].request.draft).not.toHaveProperty('transcript')
    expect(useTranscriptStore.getState().analyses).toEqual(published.speechAnalyses)
    expect(useTranscriptStore.getState().isGenerating).toBe(false)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('publishes analysis without replacing playback or reverting edits made during recognition', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    initial.draft.tracks[0].clips[0].sourceEnd = 13
    const { requests } = await renderInitialized(initial)
    const player = getAudioPlayerInstance()!
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    act(() => {
      useTimelineStore.getState().setSelectedClipId('clip-A')
      useTimelineStore.getState().splitAt(5)
      const second = useTimelineStore.getState().tracks[0].clips[1]
      useTimelineStore.getState().moveClip(second.id, 7)
      usePlaybackStore.getState().setCurrentTime(4)
      usePlaybackStore.getState().setPlaying(true)
    })
    const tracks = useTimelineStore.getState().tracks
    const history = useTimelineStore.getState().undoStack
    expect(player.getDuration()).toBe(15)
    const published = {
      ...initial,
      revision: 2,
      speechAnalyses: [{ audioSourceId: SOURCE_A } as never],
    }
    requests[0].deferred.resolve({ ...requests[0].request, value: published })
    await waitFor(() => expect(useEditorStore.getState().session?.revision).toBe(2))
    expect(getAudioPlayerInstance()).toBe(player)
    expect(mocks.players).toHaveLength(1)
    expect(mocks.players[0].pause).not.toHaveBeenCalled()
    expect(mocks.destroyPlayer).not.toHaveBeenCalled()
    expect(player.setTracks).toHaveBeenLastCalledWith(tracks)
    expect(player.getDuration()).toBe(15)
    expect(usePlaybackStore.getState()).toMatchObject({
      currentTime: 4,
      isPlaying: true,
      duration: 15,
    })
    expect(useTimelineStore.getState().tracks).toBe(tracks)
    expect(useTimelineStore.getState().undoStack).toBe(history)
    expect(useEditorStore.getState().session?.draft.tracks).toBe(tracks)
    expect(useEditorStore.getState().isDirty).toBe(true)
    expect(useTranscriptStore.getState().analyses).toEqual(published.speechAnalyses)
  })

  it.each([
    ['Save button', () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))],
    ['Save As button', () => fireEvent.click(screen.getByRole('button', { name: 'Save As' }))],
    ['keyboard Save', () => mocks.keyboardSave?.()],
  ] as const)(
    'shows the same sanitized current-session failure for %s without clearing dirty',
    async (_name, invoke) => {
      const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
      const { api } = await renderInitialized(initial)
      act(() => useEditorStore.getState().markEdited())
      api.project.save.mockRejectedValueOnce(new Error('The operation could not be completed.'))
      api.project.saveAs.mockRejectedValueOnce(new Error('The operation could not be completed.'))

      invoke()

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('The operation could not be completed.'),
      )
      expect(useEditorStore.getState().isDirty).toBe(true)
      expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A)
      expect(useEditorStore.getState().session?.revision).toBe(1)
    },
  )

  it.each(['Save', 'Save As'] as const)(
    'ignores a stale %s settlement after a successor session becomes visible',
    async (button) => {
      const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
      const successor = session(TOKEN_B, 3, SOURCE_B, 'B')
      const staleSaved = session(TOKEN_A, 2, SOURCE_A, 'Saved A')
      const pending = deferred<RendererSession | null>()
      const { api } = await renderInitialized(initial)
      act(() => useEditorStore.getState().markEdited())
      if (button === 'Save') api.project.save.mockReturnValueOnce(pending.promise)
      else api.project.saveAs.mockReturnValueOnce(pending.promise)

      fireEvent.click(screen.getByRole('button', { name: button }))
      act(() => useEditorStore.getState().loadSession(successor))
      pending.resolve(staleSaved)
      await act(async () => Promise.resolve())

      expect(useEditorStore.getState().session).toBe(successor)
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('invalidates an r1 import before an earlier keyboard Save applies r2 and ignores its late failure', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(TOKEN_A, 2, SOURCE_A, 'Saved')
    const importing = deferred<Awaited<ReturnType<IElectronAPI['audio']['startImport']>>>()
    const saving = deferred<RendererSession | null>()
    const { api, importProgress } = await renderInitialized(initial)
    api.project.save.mockReturnValueOnce(saving.promise)
    act(() => mocks.keyboardSave?.())
    api.audio.selectImportFile.mockResolvedValueOnce({
      token: 'selection-a',
      displayName: 'late.mp3',
    })
    api.audio.startImport.mockReturnValueOnce(importing.promise)

    fireEvent.click(screen.getByRole('button', { name: 'Import Audio' }))
    await waitFor(() => expect(api.audio.startImport).toHaveBeenCalledTimes(1))
    expect(mocks.keyboardSave).toBeUndefined()
    saving.resolve(saved)

    await waitFor(() => expect(useEditorStore.getState().session?.revision).toBe(2))
    expect(screen.queryByText(/Importing late\.mp3/)).toBeNull()
    act(() =>
      importProgress()({
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'job-a',
        displayName: 'late.mp3',
        stage: 'building-cache',
        percent: 0.9,
      }),
    )
    importing.reject(new Error('stale r1 import failure'))
    await act(async () => Promise.resolve())

    expect(useEditorStore.getState().session).toEqual(saved)
    expect(screen.queryByText(/Importing late\.mp3/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['Save', 'Save As'] as const)(
    'ignores a stale %s rejection after a successor session becomes visible',
    async (button) => {
      const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
      const successor = session(TOKEN_B, 3, SOURCE_B, 'B')
      const pending = deferred<RendererSession | null>()
      const { api } = await renderInitialized(initial)
      act(() => useEditorStore.getState().markEdited())
      if (button === 'Save') api.project.save.mockReturnValueOnce(pending.promise)
      else api.project.saveAs.mockReturnValueOnce(pending.promise)

      fireEvent.click(screen.getByRole('button', { name: button }))
      act(() => useEditorStore.getState().loadSession(successor))
      pending.reject(new Error('The operation could not be completed.'))
      await act(async () => Promise.resolve())

      expect(useEditorStore.getState().session).toBe(successor)
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('acknowledges a switch only after player destruction settles', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, willSwitch } = await renderInitialized(initial)
    const destruction = deferred<void>()
    mocks.destroyPlayer.mockReturnValueOnce(destruction.promise)

    let switchSettled = false
    const switching = Promise.resolve(
      willSwitch()({
        transitionId: 'transition-delayed-destroy',
        workspaceToken: TOKEN_A,
        revision: 1,
      }),
    ).then(() => {
      switchSettled = true
    })
    await waitFor(() => expect(mocks.players[0].destroy).toHaveBeenCalledTimes(1))
    expect(api.project.acknowledgeSwitch).not.toHaveBeenCalled()
    expect(switchSettled).toBe(false)

    await act(async () => {
      destruction.resolve()
      await switching
    })
    expect(api.project.acknowledgeSwitch).toHaveBeenCalledWith({
      transitionId: 'transition-delayed-destroy',
      workspaceToken: TOKEN_A,
      revision: 1,
    })
  })

  it('does not acknowledge a switch when player destruction fails', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, willSwitch } = await renderInitialized(initial)
    mocks.destroyPlayer.mockRejectedValueOnce(new Error('audio teardown failed'))

    await act(async () => {
      await willSwitch()({
        transitionId: 'transition-failed-destroy',
        workspaceToken: TOKEN_A,
        revision: 1,
      })
    })

    expect(api.project.acknowledgeSwitch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('audio teardown failed')
  })

  it('invalidates an awaited session commit before destroying its prepared player and acknowledging', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const imported = session(TOKEN_A, 2, SOURCE_B, 'Imported')
    const { api, willSwitch } = await renderInitialized(initial)
    const oldTeardown = deferred<void>()
    const stalePreparedTeardown = deferred<void>()
    mocks.destroyPlayer
      .mockReturnValueOnce(oldTeardown.promise)
      .mockReturnValueOnce(stalePreparedTeardown.promise)
    api.audio.selectImportFile.mockResolvedValueOnce({
      token: 'opaque-selection',
      displayName: 'Imported.mp3',
    })
    api.audio.startImport.mockResolvedValueOnce({
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-a',
      value: imported,
    })
    api.project.acknowledgeSwitch.mockImplementationOnce(async () => {
      expect(getAudioPlayerInstance()).toBeNull()
      return true
    })

    fireEvent.click(screen.getByRole('button', { name: 'Import Audio' }))
    await waitFor(() => expect(mocks.players).toHaveLength(2))
    await waitFor(() => expect(mocks.players[0].destroy).toHaveBeenCalledTimes(1))
    expect(getAudioPlayerInstance()).toBeNull()

    const switching = Promise.resolve(
      willSwitch()({
        transitionId: 'transition-during-load-commit',
        workspaceToken: TOKEN_A,
        revision: 1,
      }),
    )
    await Promise.resolve()
    expect(api.project.acknowledgeSwitch).not.toHaveBeenCalled()

    oldTeardown.resolve()
    await waitFor(() => expect(mocks.players[1].destroy).toHaveBeenCalledTimes(1))
    expect(useEditorStore.getState().session?.revision).toBe(1)
    expect(getAudioPlayerInstance()).toBeNull()
    expect(api.project.acknowledgeSwitch).not.toHaveBeenCalled()

    stalePreparedTeardown.resolve()
    await switching
    expect(api.project.acknowledgeSwitch).toHaveBeenCalledWith({
      transitionId: 'transition-during-load-commit',
      workspaceToken: TOKEN_A,
      revision: 1,
    })
  })

  it('submits dirty path-free opens and applies an advanced stayed rollback session', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(TOKEN_B, 2, SOURCE_A, 'Saved')
    const { api } = await renderInitialized(initial)
    act(() => useEditorStore.getState().markEdited())
    api.project.openDialog.mockResolvedValueOnce({
      outcome: 'stayed',
      reason: 'candidate-invalid',
      session: saved,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))

    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
    expect(screen.getByRole('alert').textContent).toContain('selected project could not be opened')
    expect(api.project.openDialog).toHaveBeenCalledWith({
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: true,
      draft: { tracks: initial.draft.tracks, export: initial.draft.export },
    })
  })

  it('consumes opaque forwarded opens without receiving a project path', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const successor = session(TOKEN_B, 2, SOURCE_B, 'B')
    const { api, pendingOpen } = await renderInitialized(initial)
    api.project.openPending.mockResolvedValueOnce({ outcome: 'switched', session: successor })

    await act(async () => {
      await pendingOpen()({ requestId: 'opaque-request', displayName: 'B' })
    })

    expect(api.project.openPending).toHaveBeenCalledWith({
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: false,
      requestId: 'opaque-request',
    })
    expect(JSON.stringify(api.project.openPending.mock.calls)).not.toContain('/private')
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
  })

  it('rebuilds the current session when a post-acknowledgement switch failure stays', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, willSwitch } = await renderInitialized(initial)
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await act(async () => {
      await willSwitch()({ transitionId: 'transition-a', workspaceToken: TOKEN_A, revision: 1 })
    })
    expect(mocks.players[0].destroy).toHaveBeenCalledTimes(1)

    opening.resolve({ outcome: 'stayed', reason: 'candidate-invalid', session: initial })

    await waitFor(() => expect(mocks.players).toHaveLength(2))
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A)
    expect(screen.getByRole('alert').textContent).toContain('selected project could not be opened')
  })

  it("retains dirty visible edits and undo history after Don't Save reaches a post-acknowledgement failure", async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, willSwitch } = await renderInitialized(initial)
    act(() => useTimelineStore.getState().updateTrack('track-1', { name: 'Unsaved edit' }))
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(api.project.openDialog).toHaveBeenCalledTimes(1))
    expect(api.project.openDialog.mock.calls[0][0]).toMatchObject({
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: true,
    })
    expect(
      api.project.openDialog.mock.calls[0][0].isDirty
        ? api.project.openDialog.mock.calls[0][0].draft.tracks[0].name
        : null,
    ).toBe('Unsaved edit')
    const undoCount = useTimelineStore.getState().undoStack.length
    await act(async () => {
      await willSwitch()({
        transitionId: 'discard-transition',
        workspaceToken: TOKEN_A,
        revision: 1,
      })
    })

    opening.resolve({ outcome: 'stayed', reason: 'switch-unacknowledged', session: initial })
    await waitFor(() => expect(mocks.players).toHaveLength(2))

    expect(useTimelineStore.getState().tracks[0].name).toBe('Unsaved edit')
    expect(useTimelineStore.getState().undoStack).toHaveLength(undoCount)
    expect(useEditorStore.getState().session?.draft.tracks[0].name).toBe('Unsaved edit')
    expect(useEditorStore.getState().isDirty).toBe(true)
  })

  it('applies an advanced saved rollback while retaining edits made after the open snapshot', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(TOKEN_B, 2, SOURCE_A, 'Saved')
    const { api, willSwitch } = await renderInitialized(initial)
    act(() => useTimelineStore.getState().updateTrack('track-1', { name: 'Saved snapshot' }))
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(api.project.openDialog).toHaveBeenCalledTimes(1))
    act(() => useTimelineStore.getState().updateTrack('track-2', { name: 'Edit during switch' }))
    const undoCount = useTimelineStore.getState().undoStack.length
    await act(async () => {
      await willSwitch()({
        transitionId: 'saved-edit-transition',
        workspaceToken: TOKEN_B,
        revision: 2,
      })
    })

    opening.resolve({ outcome: 'stayed', reason: 'switch-unacknowledged', session: saved })
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))

    expect(useEditorStore.getState().session?.workspace.displayName).toBe('Saved')
    expect(useTimelineStore.getState().audioSources[0].displayName).toBe('Saved.wav')
    expect(useTimelineStore.getState().tracks.map((track) => track.name)).toEqual([
      'Saved snapshot',
      'Edit during switch',
    ])
    expect(useTimelineStore.getState().undoStack).toHaveLength(undoCount)
    expect(useEditorStore.getState().session?.draft.tracks.map((track) => track.name)).toEqual([
      'Saved snapshot',
      'Edit during switch',
    ])
    expect(useEditorStore.getState().isDirty).toBe(true)
  })

  it('uses an advanced Save As rollback as authoritative when no later edit exists', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(TOKEN_B, 2, SOURCE_A, 'Saved')
    saved.draft.tracks[0] = { ...saved.draft.tracks[0], name: 'Authoritative saved track' }
    const { api, willSwitch } = await renderInitialized(initial)
    act(() => useTimelineStore.getState().updateTrack('track-1', { name: 'Submitted edit' }))
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(api.project.openDialog).toHaveBeenCalledTimes(1))
    await act(async () => {
      await willSwitch()({
        transitionId: 'save-as-transition',
        workspaceToken: TOKEN_B,
        revision: 2,
      })
    })

    opening.resolve({ outcome: 'stayed', reason: 'candidate-invalid', session: saved })
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))

    expect(useTimelineStore.getState().tracks[0].name).toBe('Authoritative saved track')
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('queues a forwarded open until the initial renderer session is ready', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const installed = installApi(initial)
    const initialization = deferred<RendererSession>()
    installed.api.project.initialize.mockReturnValueOnce(initialization.promise)
    render(<App />)
    await waitFor(() => expect(installed.api.on.pendingProjectOpen).toHaveBeenCalledTimes(1))

    act(() => {
      void installed.pendingOpen()({ requestId: 'early-request', displayName: 'Early' })
    })
    expect(installed.api.project.openPending).not.toHaveBeenCalled()

    initialization.resolve(initial)

    await waitFor(() => expect(installed.api.project.openPending).toHaveBeenCalledTimes(1))
    expect(installed.api.project.openPending).toHaveBeenCalledWith({
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: false,
      requestId: 'early-request',
    })
  })

  it('acknowledges the advanced rollback session produced by an in-flight dirty Save', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(TOKEN_B, 2, SOURCE_A, 'Saved')
    const { api, willSwitch } = await renderInitialized(initial)
    act(() => useEditorStore.getState().markEdited())
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(api.project.openDialog).toHaveBeenCalledTimes(1))

    await act(async () => {
      await willSwitch()({ transitionId: 'saved-transition', workspaceToken: TOKEN_B, revision: 2 })
    })

    expect(api.project.acknowledgeSwitch).toHaveBeenCalledWith({
      transitionId: 'saved-transition',
      workspaceToken: TOKEN_B,
      revision: 2,
    })
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A)
    opening.resolve({ outcome: 'stayed', reason: 'candidate-invalid', session: saved })
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
  })

  it('serializes manual then pending opens and constructs the second request from the first result', async () => {
    const first = session(TOKEN_A, 1, SOURCE_A, 'A')
    const second = session(TOKEN_B, 2, SOURCE_B, 'B')
    const third = session('workspace-c' as WorkspaceToken, 3, SOURCE_A, 'C')
    const installed = await renderInitialized(first)
    const manual = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    installed.api.project.openDialog.mockReturnValueOnce(manual.promise)
    installed.api.project.openPending.mockResolvedValueOnce({ outcome: 'switched', session: third })

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(installed.api.project.openDialog).toHaveBeenCalledTimes(1))
    const queued = installed.pendingOpen()({ requestId: 'queued-pending', displayName: 'C' })
    expect(installed.api.project.openPending).not.toHaveBeenCalled()

    manual.resolve({ outcome: 'switched', session: second })
    await queued

    expect(installed.api.project.openPending).toHaveBeenCalledWith({
      workspaceToken: TOKEN_B,
      revision: 2,
      isDirty: false,
      requestId: 'queued-pending',
    })
    expect(useEditorStore.getState().session?.workspaceToken).toBe(third.workspaceToken)
  })

  it('applies a first stayed result before running a queued manual open and coalesces duplicate manual clicks', async () => {
    const first = session(TOKEN_A, 1, SOURCE_A, 'A')
    const rollback = session(TOKEN_B, 2, SOURCE_A, 'Saved')
    const final = session('workspace-c' as WorkspaceToken, 3, SOURCE_B, 'Final')
    const installed = await renderInitialized(first)
    const pending = deferred<Awaited<ReturnType<IElectronAPI['project']['openPending']>>>()
    installed.api.project.openPending.mockReturnValueOnce(pending.promise)
    installed.api.project.openDialog.mockResolvedValueOnce({ outcome: 'switched', session: final })

    const firstOpen = installed.pendingOpen()({ requestId: 'first-pending', displayName: 'Saved' })
    await waitFor(() => expect(installed.api.project.openPending).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    expect(installed.api.project.openDialog).not.toHaveBeenCalled()

    pending.resolve({ outcome: 'stayed', reason: 'candidate-invalid', session: rollback })
    await firstOpen
    await waitFor(() => expect(installed.api.project.openDialog).toHaveBeenCalledTimes(1))

    expect(installed.api.project.openDialog).toHaveBeenCalledWith({
      workspaceToken: TOKEN_B,
      revision: 2,
      isDirty: false,
    })
    await waitFor(() =>
      expect(useEditorStore.getState().session?.workspaceToken).toBe(final.workspaceToken),
    )
  })

  it('continues the FIFO from the unchanged session after the first open rejects', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const successor = session(TOKEN_B, 2, SOURCE_B, 'B')
    const installed = await renderInitialized(initial)
    const failed = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    installed.api.project.openDialog.mockReturnValueOnce(failed.promise)
    installed.api.project.openPending.mockResolvedValueOnce({
      outcome: 'switched',
      session: successor,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(installed.api.project.openDialog).toHaveBeenCalledTimes(1))
    const queued = installed.pendingOpen()({ requestId: 'after-failure', displayName: 'B' })
    failed.reject(new Error('safe open failure'))
    await queued

    expect(installed.api.project.openPending).toHaveBeenCalledWith({
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: false,
      requestId: 'after-failure',
    })
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B)
  })
})
