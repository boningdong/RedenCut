import { usePreparationProgressStore } from './stores/PreparationProgressStore'
import { useSpeechBatchStore } from './stores/speechBatch.store'
import type { PublicMessage } from '@shared/publicMessages'
// @vitest-environment jsdom

import React from 'react'
import { useLocaleStore } from './stores/locale.store'
import { useWorkspaceStore } from './stores/workspace.store'
import { DEFAULT_WORKSPACE_LAYOUT } from '@shared/workspaceLayout.types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IElectronAPI, SessionJobResult, SpeechAnalysisJobId } from '@shared/ipc.types'
import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import { useEditorStore } from './stores/editor.store'
import { useTimelineStore } from './stores/TimelineStore'
import { usePlaybackStore } from './stores/PlaybackStore'
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
    currentTime = 0
    timeCallbacks = new Set<(time: number) => void>()
    getCurrentTime = vi.fn(() => this.currentTime)
    seekTo = vi.fn((time: number) => {
      this.currentTime = time
      this.timeCallbacks.forEach((callback) => callback(time))
    })
    setPlaybackMode = vi.fn()
    getDuration = vi.fn(() => this.duration)
    onTimeUpdate = vi.fn((callback: (time: number) => void) => {
      this.timeCallbacks.add(callback)
      return () => this.timeCallbacks.delete(callback)
    })
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
  WaveformView: ({
    workspaceControls,
    onAddTrack,
    isImporting,
  }: {
    workspaceControls?: React.ReactNode
    isImporting?: boolean
    onAddTrack: () => void
  }) => (
    <div data-testid="waveform">
      {workspaceControls}
      <button onClick={onAddTrack} disabled={isImporting}>
        Add Track
      </button>
    </div>
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
    onRun,
    isGenerating,
    generatingStatus,
    onCancel,
  }: {
    workspaceControls?: React.ReactNode
    onGenerate: (trackId?: string) => void
    onRun: (scope: { kind: 'all' }, tasks: { text: 'replace'; speakers: 'replace' }) => void
    isGenerating: boolean
    onCancel?: () => void
    generatingStatus: { stage: string } | null
  }) => (
    <div>
      {workspaceControls}
      <button onClick={() => onGenerate('track-1')}>Generate transcript</button>
      <button onClick={onCancel}>Cancel speech</button>
      <button onClick={() => onRun({ kind: 'all' }, { text: 'replace', speakers: 'replace' })}>
        Regenerate transcript
      </button>
      <button onClick={() => onGenerate()}>Generate all</button>
      <span data-testid="generation-state">
        {String(isGenerating)}:{generatingStatus?.stage}
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
  let projectOpenProgress!: Parameters<IElectronAPI['on']['projectOpenProgress']>[0]
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
    resourcesOpenGuide: vi.fn(async () => {}),
    resourcesSelectWhisper: vi.fn(async () => ({ revision: 1, resources: [], baseReady: false })),
    resourcesGet: vi.fn(async () => ({ revision: 0, resources: [], baseReady: false })),
    resourcesPrepare: vi.fn<IElectronAPI['resourcesPrepare']>(),
    resourcesCancel: vi.fn<IElectronAPI['resourcesCancel']>(),
    onResourcesChanged: vi.fn(() => vi.fn()),

    appPreferences: {
      get: vi.fn<IElectronAPI['appPreferences']['get']>(async () => ({
        themeId: 'dark',
        whisperModelId: 'transcription-default',
        themePreferenceSet: true,
        textEditingEnabled: true,
        speakerRecognitionEnabled: true,
        onboardingDisposition: 'skipped',
        preference: 'system',
        resolvedLocale: 'en',
        revision: 0,
        warning: null,
      })),
      setTheme: vi.fn<IElectronAPI['appPreferences']['setTheme']>(),
      migrateTheme: vi.fn<IElectronAPI['appPreferences']['migrateTheme']>(),
      setFeaturePreferences: vi.fn<IElectronAPI['appPreferences']['setFeaturePreferences']>(),
      setOnboardingDisposition: vi.fn<IElectronAPI['appPreferences']['setOnboardingDisposition']>(),
      setLocale: vi.fn<IElectronAPI['appPreferences']['setLocale']>(),
      onChanged: vi.fn<IElectronAPI['appPreferences']['onChanged']>(() => vi.fn()),
    },
    workspaceLayout: {
      get: vi.fn<IElectronAPI['workspaceLayout']['get']>(async () => ({
        layout: DEFAULT_WORKSPACE_LAYOUT,
        warning: null,
      })),
      set: vi.fn<IElectronAPI['workspaceLayout']['set']>(),
    },
    mediaRecovery: {
      locate: vi.fn(async () => {}),
      continue: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    },
    project: {
      respondToClose: vi.fn(async () => true),
      initialize: vi.fn(async () => initial),
      openStarter: vi.fn<IElectronAPI['project']['openStarter']>(async () => ({
        outcome: 'stayed',
        reason: 'cancelled',
        session: initial,
      })),
      openDialog,
      openPending,
      acknowledgeSwitch: vi.fn(async () => true),
      save: saveProject,
      saveAs: saveProjectAs,
    },
    audio: {
      selectImportFile: vi.fn<IElectronAPI['audio']['selectImportFile']>(async () => null),
      startImport: vi.fn<IElectronAPI['audio']['startImport']>(),
      cancelImport: vi.fn<IElectronAPI['audio']['cancelImport']>(async () => 'not-found'),
    },
    transcript: {
      checkAvailability: vi.fn(async (): Promise<PublicMessage | null> => null),
      generate: vi.fn(),
      cancel: vi.fn(async () => 'not-found' as const),
    },
    speechAnalysis: {
      checkAvailability: vi.fn(async (): Promise<PublicMessage | null> => null),
      start: vi.fn((request) => {
        const pending = deferred<SessionJobResult<RendererSession, SpeechAnalysisJobId>>()
        requests.push({ request, deferred: pending })
        return pending.promise
      }),
      cancel: vi.fn(async () => 'not-found' as const),
    },
    diagnostics: {
      recentFailure: vi.fn(async () => null),
      previewReport: vi.fn(),
      saveReport: vi.fn(),
      showSavedReport: vi.fn(),
    },
    speakerIdentity: { save: vi.fn() },
    speakerLabel: {
      rename: vi.fn(),
    },
    render: {
      startExport: vi.fn(),
      cancelExport: vi.fn(async () => 'not-found' as const),
    },
    on: {
      openRecentDiagnostic: vi.fn(() => vi.fn()),
      projectCommand: vi.fn<IElectronAPI['on']['projectCommand']>(() => vi.fn()),
      projectCloseRequest: vi.fn<IElectronAPI['on']['projectCloseRequest']>(() => vi.fn()),
      mediaRecoveryChanged: vi.fn(() => vi.fn()),
      projectOpenProgress: vi.fn((callback) => {
        projectOpenProgress = callback
        return vi.fn()
      }),
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
    preparedAudio: {
      progress: vi.fn().mockResolvedValue(null),
      prepare: vi.fn(),
      read: vi.fn(),
      waveform: vi.fn(),
      release: vi.fn(),
    },
  } satisfies IElectronAPI
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  return {
    api,
    requests,
    importProgress: () => importProgress,
    openProgress: () => projectOpenProgress,
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

function clickProjectAction(name: string) {
  if (name === 'Save') return fireEvent.click(screen.getByRole('button', { name }))
  fireEvent.click(document.querySelector('.project-name')!)
  return fireEvent.click(screen.getByRole('menuitem', { name }))
}

describe('App transcription job identity', () => {
  beforeEach(() => {
    usePreparationProgressStore.setState({ active: null, opening: null, importing: null })
    useLocaleStore.setState({ preference: 'en', resolvedLocale: 'en' })
    useEditorStore.getState().reset()
    useTimelineStore.getState().reset()
    useTranscriptStore.getState().reset()
    useSpeechBatchStore.getState().reset()
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

  it('keeps the audio workspace mounted when empty and limits header actions to project controls', async () => {
    const empty = session(TOKEN_A, 1, SOURCE_A, 'Empty')
    empty.sources = []
    empty.draft.tracks = []
    await renderInitialized(empty)
    expect(screen.getByTestId('waveform')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add Track' })).toBeTruthy()
    const header = document.querySelector('.project-header')!
    expect(
      [...header.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    ).toEqual(['Empty', 'Save', 'Export'])
    expect(header.querySelector('.project-brand')).toBeNull()
  })

  it('does not re-render the workspace for repeated volume updates but forwards every gain to playback', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    installApi(initial)
    const committed = vi.fn()
    render(
      <React.Profiler id="app" onRender={committed}>
        <App />
      </React.Profiler>,
    )
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A))
    const id = useTimelineStore.getState().tracks[0].id
    act(() => useTimelineStore.getState().updateTrack(id, { volume: 0.5 }))
    committed.mockClear()
    const forward = vi.spyOn(getAudioPlayerInstance()!, 'setTracks')
    for (let i = 0; i < 20; i++)
      act(() => useTimelineStore.getState().updateTrack(id, { volume: i / 20 }))
    expect(committed.mock.calls.length).toBe(0)
    expect(forward).toHaveBeenCalledTimes(20)
    expect(forward.mock.calls[forward.mock.calls.length - 1][0][0].volume).toBe(0.95)
    forward.mockRestore()
  })

  it('changes header language without resetting playback, project edits, or timeline history', async () => {
    const { api, requests } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    act(() => {
      useTimelineStore.getState().setSelectedClipId('clip-A')
      useTimelineStore.getState().splitAt(5)
      getAudioPlayerInstance()!.seekTo(4)
      usePlaybackStore.getState().setPlaying(true)
    })
    const player = getAudioPlayerInstance()
    const editor = useEditorStore.getState()
    const timeline = useTimelineStore.getState()
    const playback = usePlaybackStore.getState()
    const transcript = useTranscriptStore.getState()
    act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
    expect(screen.getByRole('button', { name: '导出' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '语言' })).toBeNull()
    expect(getAudioPlayerInstance()).toBe(player)
    expect(mocks.players).toHaveLength(1)
    expect(mocks.destroyPlayer).not.toHaveBeenCalled()
    expect(useEditorStore.getState()).toBe(editor)
    expect(useTimelineStore.getState()).toBe(timeline)
    expect(usePlaybackStore.getState()).toBe(playback)
    expect(useTranscriptStore.getState()).toBe(transcript)
    expect(requests).toHaveLength(1)
    expect(api.speechAnalysis.cancel).not.toHaveBeenCalled()
    expect(mocks.players[0].pause).not.toHaveBeenCalled()
  })

  it('retranslates a retained actionable availability error without changing the session or player', async () => {
    const { api, requests } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    vi.mocked(api.speechAnalysis.checkAvailability).mockResolvedValue({ reason: 'whisper-missing' })
    const player = getAudioPlayerInstance()
    const before = useEditorStore.getState().session
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('speech recognition engine'),
    )
    act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
    expect(screen.getByRole('alert').textContent).toContain('语音识别引擎无法使用')
    expect(screen.getByRole('alert').textContent).toContain('修复或重新安装应用')
    expect(getAudioPlayerInstance()).toBe(player)
    expect(useEditorStore.getState().session).toBe(before)
    expect(requests).toHaveLength(0)
  })

  it('keeps the active player, project state and timeline history when workspace panels move', async () => {
    const { api } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    const player = getAudioPlayerInstance()
    const editor = useEditorStore.getState()
    const timeline = useTimelineStore.getState()
    const regions = document.querySelector('.workspace-regions')!
    vi.spyOn(regions, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 900,
      top: 0,
      bottom: 400,
      width: 900,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(
      screen.getByRole('region', { name: 'Audio panel' }),
      'getBoundingClientRect',
    ).mockReturnValue({
      left: 0,
      right: 900,
      top: 201,
      bottom: 327,
      width: 900,
      height: 126,
      x: 0,
      y: 201,
      toJSON: () => ({}),
    })
    const drop = (label: string, y: number) => {
      const down = new MouseEvent('pointerdown', { bubbles: true, button: 0 })
      Object.defineProperty(down, 'pointerId', { value: 1 })
      fireEvent(screen.getByRole('button', { name: `Drag ${label} panel` }), down)
      const move = new MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: y })
      Object.defineProperty(move, 'pointerId', { value: 1 })
      fireEvent(window, move)
      const up = new MouseEvent('pointerup', { bubbles: true, clientX: 400, clientY: y })
      Object.defineProperty(up, 'pointerId', { value: 1 })
      fireEvent(window, up)
    }
    drop('Transcript', 260)
    drop('Transport', 10)
    expect(getAudioPlayerInstance()).toBe(player)
    expect(mocks.players).toHaveLength(1)
    expect(mocks.destroyPlayer).not.toHaveBeenCalled()
    expect(useEditorStore.getState()).toBe(editor)
    expect(useTimelineStore.getState()).toBe(timeline)
    await waitFor(() => expect(api.workspaceLayout.set).toHaveBeenCalled())
  })

  it.each(['legacy', 'catalog'])(
    'confirms %s speaker edits in the current language',
    async (kind) => {
      const { requests } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
      const provenance = {
        engineId: 'test',
        engineVersion: '1',
        modelId: 'test',
        configHash: '0'.repeat(64),
        artifactSchemaVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      }
      act(() =>
        useTranscriptStore.getState().loadAnalyses([
          {
            audioSourceId: SOURCE_A,
            analysisRevisionId: 'revision' as never,
            transcript: {
              id: 'transcript' as never,
              revision: 1,
              mode: 'verbatim',
              units: [],
              provenance,
            },
            alignment: {
              id: 'alignment' as never,
              transcriptArtifactId: 'transcript' as never,
              transcriptRevision: 1,
              acousticEditUnits: [],
              provenance,
            },
            diarization: { id: 'diarization' as never, turns: [], provenance },
            speakerAttribution: {
              analysisRevisionId: 'revision' as never,
              alignmentArtifactId: 'alignment' as never,
              diarizationArtifactId: 'diarization' as never,
              attributions: [],
              provenance: {
                algorithmId: 'test',
                algorithmVersion: '1',
                configHash: '0'.repeat(64),
                artifactSchemaVersion: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            },
            speakers: [
              {
                id: 'speaker' as never,
                analysisRevisionId: 'revision' as never,
                diarizationLabel: 'SPEAKER_00',
                defaultDisplayName: 'Speaker 1',
              },
            ],
            speakerLabelOverrides:
              kind === 'legacy'
                ? [{ speakerId: 'speaker' as never, displayName: 'Custom name' }]
                : [],
          },
        ]),
      )
      if (kind === 'catalog') {
        const current = useEditorStore.getState().session!
        act(() =>
          useEditorStore.setState({
            session: {
              ...current,
              speakerIdentities: {
                version: 1,
                people: [
                  {
                    id: 'person',
                    displayName: 'Host',
                    color: '#112233',
                    binding: {
                      audioSourceId: SOURCE_A,
                      analysisRevisionId: 'revision' as never,
                      speakerId: 'speaker' as never,
                    },
                  },
                ],
                associations: [],
              },
            },
          }),
        )
      }
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate transcript' }))
      expect(confirm).toHaveBeenLastCalledWith(
        'Re-analysis will replace speaker identities for these recordings. Current speaker names, colors and associations will need to be set again. Continue?',
      )
      expect(requests).toHaveLength(0)
      act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate transcript' }))
      expect(confirm).toHaveBeenLastCalledWith(
        '重新分析将替换这些录音的说话人身份，当前说话人名称、颜色和关联需要重新设置。是否继续？',
      )
      expect(requests).toHaveLength(0)
      confirm.mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate transcript' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      expect(requests[0].request.confirmSpeakerLabelReset).toBe(true)
      confirm.mockRestore()
    },
  )

  it('does not dispatch analysis when cancelled during availability lookup', async () => {
    const { api, requests } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    const availability = deferred<null>()
    vi.mocked(api.speechAnalysis.checkAvailability).mockReturnValueOnce(availability.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(api.speechAnalysis.checkAvailability).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel speech' }))
    await act(async () => availability.resolve(null))
    expect(requests).toHaveLength(0)
    expect(useSpeechBatchStore.getState().isGenerating).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retains published text and reports cancellation when the stopped batch rejects', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { requests, progress } = await renderInitialized(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Generate all' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    const published = {
      ...initial,
      revision: 2,
      speechAnalyses: [{ audioSourceId: SOURCE_A } as never],
    }
    await act(async () =>
      progress()({ ...requests[0].request, stage: 'diarizing', session: published }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel speech' }))
    await act(async () => requests[0].deferred.reject({ reason: 'operation-cancelled' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useSpeechBatchStore.getState().cancelled).toBe(true)
    expect(useSpeechBatchStore.getState().isGenerating).toBe(false)
    expect(useTranscriptStore.getState().analyses).toEqual(published.speechAnalyses)
  })

  it('forwards timing only for the active job and cancels that job', async () => {
    const { api, requests, progress } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    const status = {
      stage: 'diarizing' as const,
      stageStartedAtMs: 1000,
      estimatedDurationMs: 5000,
    }
    act(() => progress()({ ...requests[0].request, ...status }))
    expect(useSpeechBatchStore.getState().generatingStatus).toMatchObject(status)
    act(() =>
      progress()({
        ...requests[0].request,
        workspaceToken: TOKEN_B,
        stage: 'aligning',
        stageStartedAtMs: 9000,
      }),
    )
    expect(useSpeechBatchStore.getState().generatingStatus).toMatchObject(status)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel speech' }))
    expect(api.speechAnalysis.cancel).toHaveBeenCalledWith({
      jobId: requests[0].request.jobId,
      workspaceToken: TOKEN_A,
      revision: 1,
    })
  })

  it.each(['workspace', 'current'] as const)(
    'scopes asynchronous cancellation errors to the current job and workspace: %s',
    async (transition) => {
      const { api, requests } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
      const cancellation = deferred<'not-found'>()
      vi.mocked(api.speechAnalysis.cancel).mockReturnValueOnce(cancellation.promise)
      fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel speech' }))
      if (transition === 'workspace') {
        act(() => useEditorStore.setState({ session: session(TOKEN_B, 1, SOURCE_B, 'B') }))
      }
      await act(async () => {
        cancellation.reject({ reason: 'operation-failed' })
      })
      if (transition === 'current')
        expect(screen.getByRole('alert').textContent).toBe('The operation could not be completed.')
      else expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('applies the authoritative speech-analysis session without making analysis a local edit', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const published = session(TOKEN_A, 2, SOURCE_A, 'A')
    published.speechAnalyses = [{ audioSourceId: SOURCE_A } as never]
    const { requests, progress } = await renderInitialized(initial)

    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    act(() => progress()({ ...requests[0].request, stage: 'aligning', percent: 50 }))
    expect(useSpeechBatchStore.getState().generatingStatus).toEqual({
      stage: 'aligning',
      percent: 50,
    })
    requests[0].deferred.resolve({
      jobId: requests[0].request.jobId,
      workspaceToken: requests[0].request.workspaceToken,
      revision: requests[0].request.revision,
      value: published,
    })

    await waitFor(() => expect(useEditorStore.getState().session?.revision).toBe(2))
    expect(requests[0].request.draft).not.toHaveProperty('transcript')
    expect(useTranscriptStore.getState().analyses).toEqual(published.speechAnalyses)
    expect(useSpeechBatchStore.getState().isGenerating).toBe(false)
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
      getAudioPlayerInstance()!.seekTo(4)
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
    expect(useTimelineStore.getState().tracks).toEqual(tracks)
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
    ['Save As button', () => clickProjectAction('Save As')],
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

      clickProjectAction(button)
      act(() => useEditorStore.getState().loadSession(successor))
      pending.resolve(staleSaved)
      await act(async () => Promise.resolve())

      expect(useEditorStore.getState().session).toBe(successor)
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('rebinds playback after Save As while retaining the playhead and track edits', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(TOKEN_B, 2, SOURCE_A, 'Saved')
    const { api } = await renderInitialized(initial)
    const originalPlayer = getAudioPlayerInstance()!
    originalPlayer.seekTo(2)
    act(() => useTimelineStore.getState().setTrackGain('track-1', 3))
    api.project.saveAs.mockResolvedValueOnce(saved)
    clickProjectAction('Save As')
    await waitFor(() => expect(getAudioPlayerInstance()).not.toBe(originalPlayer))
    await waitFor(() => expect(getAudioPlayerInstance()?.getCurrentTime()).toBe(2))
    expect(mocks.players[0].destroy).toHaveBeenCalled()
    expect(useTimelineStore.getState().tracks[0].gainDb).toBe(3)
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('keeps an r1 import active across an ordinary save revision and reports its failure', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
    await waitFor(() => expect(api.audio.startImport).toHaveBeenCalledTimes(1))
    expect((screen.getByRole('button', { name: 'Add Track' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
    expect(api.audio.startImport).toHaveBeenCalledTimes(1)
    expect(mocks.keyboardSave).toBeUndefined()
    saving.resolve(saved)

    await waitFor(() => expect(useEditorStore.getState().session?.revision).toBe(2))
    expect(screen.queryByTitle('late.mp3')).not.toBeNull()
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
    expect(screen.queryByTitle('late.mp3')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('The operation could not be completed.')
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

      clickProjectAction(button)
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
    expect(screen.getByRole('alert').textContent).toBe('The operation could not be completed.')
  })

  it('cancels an ongoing import while a pending project open is visible', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, pendingOpen, openProgress } = await renderInitialized(initial)
    const importing = deferred<Awaited<ReturnType<IElectronAPI['audio']['startImport']>>>()
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openPending']>>>()
    api.audio.selectImportFile.mockResolvedValueOnce({
      token: 'selection',
      displayName: 'voice.wav',
    })
    api.audio.startImport.mockReturnValueOnce(importing.promise)
    api.project.openPending.mockReturnValueOnce(opening.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
    await waitFor(() => expect(api.audio.startImport).toHaveBeenCalledOnce())
    act(() => {
      void pendingOpen()({ requestId: 'pending-overlap', displayName: 'Other.redencut' })
    })
    await waitFor(() => expect(api.project.openPending).toHaveBeenCalledOnce())
    const operationId = api.project.openPending.mock.calls[0][0].operationId
    act(() =>
      openProgress()({
        operationId,
        sequence: 1,
        stage: 'reading-project',
        progress: { kind: 'indeterminate' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    await waitFor(() =>
      expect(api.audio.cancelImport).toHaveBeenCalledWith({
        workspaceToken: TOKEN_A,
        revision: 1,
        jobId: 'job-a',
      }),
    )
    expect(screen.getByText('Reading project…')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Cancel import' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    importing.reject(new Error('cancelled'))
    opening.resolve({ outcome: 'stayed', reason: 'cancelled', session: initial })
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  })

  it('holds cancellation pending and applies a commit-won import before clearing progress', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const imported = session(TOKEN_A, 2, SOURCE_B, 'Imported')
    const { api } = await renderInitialized(initial)
    const importing = deferred<Awaited<ReturnType<IElectronAPI['audio']['startImport']>>>()
    const registration = deferred<void>()
    api.audio.selectImportFile.mockResolvedValueOnce({
      token: 'selection',
      displayName: 'voice.wav',
    })
    api.audio.startImport.mockReturnValueOnce(importing.promise)
    api.audio.cancelImport.mockResolvedValueOnce('commit-won')
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
    await waitFor(() => expect(api.audio.startImport).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.audio.cancelImport).toHaveBeenCalledOnce())
    expect(screen.getByText('Cancelling…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    mocks.registerAudioSource.mockReturnValueOnce(registration.promise)
    importing.resolve({ workspaceToken: TOKEN_A, revision: 1, jobId: 'job-a', value: imported })
    await waitFor(() => expect(screen.getByText('Preparing editor…')).toBeTruthy())
    registration.resolve()
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    expect(useEditorStore.getState().session?.revision).toBe(2)
  })

  it('ignores import registration completion after a project switch', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const imported = session(TOKEN_A, 2, SOURCE_B, 'Imported')
    const { api, willSwitch } = await renderInitialized(initial)
    const registration = deferred<void>()
    mocks.registerAudioSource.mockReturnValueOnce(registration.promise)
    api.audio.selectImportFile.mockResolvedValueOnce({
      token: 'selection',
      displayName: 'Imported.mp3',
    })
    api.audio.startImport.mockResolvedValueOnce({
      workspaceToken: TOKEN_A,
      revision: 1,
      jobId: 'job-a',
      value: imported,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
    await waitFor(() => expect(mocks.registerAudioSource).toHaveBeenCalledTimes(2))
    await act(async () => {
      await willSwitch()({ transitionId: 'switch-import', workspaceToken: TOKEN_A, revision: 1 })
    })
    await act(async () => registration.resolve())
    expect(useEditorStore.getState().session?.revision).toBe(1)
    expect(getAudioPlayerInstance()).toBeNull()
    expect(api.project.acknowledgeSwitch).toHaveBeenCalled()
  })

  it.each(['import-first', 'speech-first'] as const)(
    'reconciles %s completion with local edits and active progress',
    async (order) => {
      const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
      const added = session(TOKEN_A, 2, SOURCE_B, 'B')
      added.draft.tracks[0].id = 'track-added'
      const imported = {
        ...initial,
        revision: 2,
        sources: [...initial.sources, ...added.sources],
        draft: { ...initial.draft, tracks: [...initial.draft.tracks, ...added.draft.tracks] },
      }
      const analyzed = {
        ...imported,
        revision: 3,
        speechAnalyses: [{ audioSourceId: SOURCE_A } as never],
      }
      const { api, requests, progress } = await renderInitialized(initial)
      const pendingImport = deferred<Awaited<ReturnType<IElectronAPI['audio']['startImport']>>>()
      api.audio.selectImportFile.mockResolvedValueOnce({ token: 'selection', displayName: 'B.mp3' })
      api.audio.startImport.mockReturnValueOnce(pendingImport.promise)
      fireEvent.click(screen.getByRole('button', { name: 'Generate all' }))
      await waitFor(() => expect(requests).toHaveLength(1))
      fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
      await waitFor(() => expect(api.audio.startImport).toHaveBeenCalledTimes(1))
      const importRequest = api.audio.startImport.mock.calls[0][0]
      const player = getAudioPlayerInstance()
      act(() => {
        useTimelineStore.getState().updateTrack('track-1', { name: 'Edited' })
        useTimelineStore.getState().setSelectedClipId('clip-A')
        useTimelineStore.getState().splitAt(5)
        const second = useTimelineStore.getState().tracks[0].clips[1]
        useTimelineStore.getState().moveClip(second.id, 7)
        void useTimelineStore.getState().undo()
      })
      const publish = async () => {
        await act(async () =>
          progress()({ ...requests[0].request, stage: 'diarizing', session: analyzed }),
        )
      }
      const finishImport = async () => {
        await act(async () => pendingImport.resolve({ ...importRequest, value: imported }))
      }
      if (order === 'import-first') {
        await finishImport()
        await publish()
      } else {
        await publish()
        await finishImport()
      }
      expect(useEditorStore.getState().session?.revision).toBe(3)
      expect(useTimelineStore.getState().tracks.map((track) => track.name)).toEqual([
        'Edited',
        'Notes',
        'Primary',
      ])
      expect(useTranscriptStore.getState().analyses).toEqual(analyzed.speechAnalyses)
      expect(useSpeechBatchStore.getState().isGenerating).toBe(true)
      expect(useSpeechBatchStore.getState().generatingStatus?.stage).toBe('diarizing')
      expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
      void act(() => useTimelineStore.getState().redo())
      expect(useTimelineStore.getState().tracks[0].clips[1].outputStart).toBe(7)
      expect(useTimelineStore.getState().tracks.some((track) => track.id === 'track-added')).toBe(
        true,
      )
      act(() => {
        void useTimelineStore.getState().undo()
        void useTimelineStore.getState().undo()
      })
      expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(1)
      expect(useTimelineStore.getState().tracks.some((track) => track.id === 'track-added')).toBe(
        true,
      )
      void act(() => useTimelineStore.getState().redo())
      expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
      expect(useTimelineStore.getState().tracks.some((track) => track.id === 'track-added')).toBe(
        true,
      )
      expect(getAudioPlayerInstance()).toBe(player)
      expect(useEditorStore.getState().isDirty).toBe(true)
      act(() => useTimelineStore.getState().removeTrack('track-added'))
      for (const revision of [4, 5]) {
        await act(async () =>
          progress()({
            ...requests[0].request,
            stage: 'diarizing',
            session: { ...analyzed, revision },
          }),
        )
        expect(useTimelineStore.getState().tracks.some((track) => track.id === 'track-added')).toBe(
          false,
        )
      }
    },
  )

  it('ignores an old terminal summary after switching and starting a new batch during source registration', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, requests, willSwitch } = await renderInitialized(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Generate all' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    const registration = deferred<void>()
    mocks.registerAudioSource.mockReturnValueOnce(registration.promise)
    await act(async () =>
      requests[0].deferred.resolve({
        ...requests[0].request,
        value: session(TOKEN_A, 2, SOURCE_B, 'Imported'),
      }),
    )
    await waitFor(() => expect(mocks.registerAudioSource).toHaveBeenCalledTimes(2))
    await act(async () =>
      willSwitch()({ transitionId: 'switch-terminal', workspaceToken: TOKEN_A, revision: 1 }),
    )
    api.project.openDialog.mockResolvedValueOnce({
      outcome: 'switched',
      session: session(TOKEN_B, 1, SOURCE_B, 'B'),
    })
    clickProjectAction('Open Project')
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
    fireEvent.click(screen.getByRole('button', { name: 'Generate all' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => registration.resolve())
    expect(useSpeechBatchStore.getState().isGenerating).toBe(true)
    expect(useSpeechBatchStore.getState().summary).toBeNull()
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B)
  })

  it('admits a selected import when speech advances the revision while the picker is open', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, requests, progress } = await renderInitialized(initial)
    const selection = deferred<{ token: string; displayName: string } | null>()
    api.audio.selectImportFile.mockReturnValueOnce(selection.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].request.scope).toEqual({ kind: 'track', trackId: 'track-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Add Track' }))
    await act(async () =>
      progress()({
        ...requests[0].request,
        stage: 'diarizing',
        session: { ...initial, revision: 2 },
      }),
    )
    await act(async () => selection.resolve({ token: 'selection', displayName: 'B.wav' }))
    expect(api.audio.startImport).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2, selectionToken: 'selection' }),
    )
    expect(useSpeechBatchStore.getState().isGenerating).toBe(true)
  })

  it('admits all sources after an empty first track and uses a track scope for track generation', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    initial.draft.tracks.unshift({ ...initial.draft.tracks[0], id: 'empty', clips: [] })
    const { requests } = await renderInitialized(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Generate all' }))
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].request).toMatchObject({
      scope: { kind: 'all' },
      tasks: { text: 'missing', speakers: 'missing' },
    })
    expect(requests[0].request.draft.tracks).toHaveLength(3)
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

    clickProjectAction('Open Project')

    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
    expect(screen.getByRole('alert').textContent).toContain('selected project could not be opened')
    expect(api.project.openDialog).toHaveBeenCalledWith({
      operationId: expect.any(String),
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
      operationId: expect.any(String),
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: false,
      requestId: 'opaque-request',
    })
    expect(JSON.stringify(api.project.openPending.mock.calls)).not.toContain('/private')
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
  })

  it('keeps open progress through renderer preparation and ignores late main ticks', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const successor = session(TOKEN_B, 1, SOURCE_B, 'B')
    const { api, openProgress } = await renderInitialized(initial)
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    const registration = deferred<void>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)
    clickProjectAction('Open Project')
    await waitFor(() => expect(api.project.openDialog).toHaveBeenCalledOnce())
    expect(screen.queryByRole('progressbar')).toBeNull()
    const operationId = api.project.openDialog.mock.calls[0][0].operationId
    act(() =>
      openProgress()({
        operationId,
        sequence: 1,
        stage: 'reading-project',
        progress: { kind: 'indeterminate' },
      }),
    )
    expect(screen.getByText('Reading project…')).toBeTruthy()
    mocks.registerAudioSource.mockReturnValueOnce(registration.promise)
    opening.resolve({ outcome: 'switched', session: successor })
    await waitFor(() => expect(screen.getByText('Preparing editor…')).toBeTruthy())
    act(() =>
      openProgress()({
        operationId,
        sequence: 2,
        stage: 'switching-session',
        progress: { kind: 'indeterminate' },
      }),
    )
    expect(screen.getByText('Preparing editor…')).toBeTruthy()
    registration.resolve()
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
    act(() =>
      openProgress()({
        operationId,
        sequence: 3,
        stage: 'switching-session',
        progress: { kind: 'indeterminate' },
      }),
    )
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('rebuilds the current session when a post-acknowledgement switch failure stays', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, willSwitch } = await renderInitialized(initial)
    const opening = deferred<Awaited<ReturnType<IElectronAPI['project']['openDialog']>>>()
    api.project.openDialog.mockReturnValueOnce(opening.promise)

    clickProjectAction('Open Project')
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

    clickProjectAction('Open Project')
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

    clickProjectAction('Open Project')
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
    clickProjectAction('Open Project')
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
      operationId: expect.any(String),
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
    clickProjectAction('Open Project')
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

    clickProjectAction('Open Project')
    await waitFor(() => expect(installed.api.project.openDialog).toHaveBeenCalledTimes(1))
    const queued = installed.pendingOpen()({ requestId: 'queued-pending', displayName: 'C' })
    expect(installed.api.project.openPending).not.toHaveBeenCalled()

    manual.resolve({ outcome: 'switched', session: second })
    await queued

    expect(installed.api.project.openPending).toHaveBeenCalledWith({
      operationId: expect.any(String),
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
    clickProjectAction('Open Project')
    clickProjectAction('Open Project')
    expect(installed.api.project.openDialog).not.toHaveBeenCalled()

    pending.resolve({ outcome: 'stayed', reason: 'candidate-invalid', session: rollback })
    await firstOpen
    await waitFor(() => expect(installed.api.project.openDialog).toHaveBeenCalledTimes(1))

    expect(installed.api.project.openDialog).toHaveBeenCalledWith({
      operationId: expect.any(String),
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

    clickProjectAction('Open Project')
    await waitFor(() => expect(installed.api.project.openDialog).toHaveBeenCalledTimes(1))
    const queued = installed.pendingOpen()({ requestId: 'after-failure', displayName: 'B' })
    failed.reject(new Error('safe open failure'))
    await queued

    expect(installed.api.project.openPending).toHaveBeenCalledWith({
      operationId: expect.any(String),
      workspaceToken: TOKEN_A,
      revision: 1,
      isDirty: false,
      requestId: 'after-failure',
    })
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B)
  })
})

describe('project commands', () => {
  it('uses the same protected new-project transition for the menu and native close', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    initial.workspace.kind = 'temporary'
    const { api } = await renderInitialized(initial)
    const command = api.on.projectCommand.mock.calls[api.on.projectCommand.mock.calls.length - 1][0]
    act(() => command('new'))
    await waitFor(() => expect(api.project.openStarter).toHaveBeenCalled())
    expect(api.project.openStarter.mock.calls[0][0].isDirty).toBe(true)
    const close =
      api.on.projectCloseRequest.mock.calls[api.on.projectCloseRequest.mock.calls.length - 1][0]
    act(() => close({ requestId: 'close-a' }))
    await waitFor(() => expect(api.project.respondToClose).toHaveBeenCalledWith('close-a', false))
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A)
    expect(screen.getByText('Not saved as a project')).toBeTruthy()
  })
})

it('keeps native project commands and close requests outside a custom modal workflow', async () => {
  const { api } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
  const modal = document.createElement('div')
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  document.body.appendChild(modal)
  try {
    act(() => api.on.projectCommand.mock.calls[0][0]('new'))
    act(() => api.on.projectCloseRequest.mock.calls[0][0]({ requestId: 'blocked' }))
    await waitFor(() => expect(api.project.respondToClose).toHaveBeenCalledWith('blocked', false))
    expect(api.project.openStarter).not.toHaveBeenCalled()
  } finally {
    modal.remove()
  }
})
