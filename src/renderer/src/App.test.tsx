// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IElectronAPI, SessionJobResult } from '@shared/ipc.types'
import type { AudioSourceId, Transcript } from '@shared/project.types'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import type { TranscriptionJobId } from '@shared/transcriber.types'
import { useEditorStore } from './stores/editor.store'
import { useTimelineStore } from './stores/timeline.store'
import { useTranscriptStore } from './stores/transcript.store'

const mocks = vi.hoisted(() => ({
  registerAudioSource: vi.fn(async (_id?: unknown, _provider?: unknown): Promise<void> => {}),
  players: [] as Array<{ pause: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>,
}))

vi.mock('./audio/WorkletAudioPlayer', () => ({
  WorkletAudioPlayer: class {
    constructor() {
      mocks.players.push(this)
    }
    registerAudioSource = mocks.registerAudioSource
    pause = vi.fn()
    setTracks = vi.fn()
    getDuration = vi.fn(() => 10)
    onTimeUpdate = vi.fn(() => vi.fn())
    onPlayStateChange = vi.fn(() => vi.fn())
    onDurationChange = vi.fn(() => vi.fn())
    onEnded = vi.fn(() => vi.fn())
    onError = vi.fn(() => vi.fn())
    destroy = vi.fn()
  },
}))
vi.mock('./audio/samples/ContinuousPcmSampleProvider', () => ({
  ContinuousPcmSampleProvider: class {},
}))
vi.mock('./components/Waveform/BinaryWaveformDataProvider', () => ({
  BinaryWaveformDataProvider: class {},
}))
vi.mock('./components/Waveform/WaveformView', () => ({
  WaveformView: () => <div data-testid="waveform" />,
}))
vi.mock('./components/FileInfoPanel', () => ({ FileInfoPanel: () => null }))
vi.mock('./components/Transport/TransportBar', () => ({ TransportBar: () => null }))
vi.mock('./components/Export/ExportModal', () => ({ ExportModal: () => null }))
vi.mock('./hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => undefined }))
vi.mock('./components/Transcript/TranscriptPanel', () => ({
  TranscriptPanel: ({
    onGenerate,
    isGenerating,
    generatingStatus,
  }: {
    onGenerate: (trackId: string) => void
    isGenerating: boolean
    generatingStatus: string
  }) => (
    <div>
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
      transcript: {
        engine: 'seed',
        words: [
          {
            id: `seed-${displayName}`,
            text: `seed-${displayName}`,
            start: 0,
            end: 1,
            muted: false,
            trackId: 'track-2',
            audioSourceId: sourceId,
          },
        ],
        speakers: {},
      },
      export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48_000 },
    },
  }
}

function result(
  request: { jobId: TranscriptionJobId; workspaceToken: WorkspaceToken; revision: number },
  text: string,
): SessionJobResult<Transcript, TranscriptionJobId> {
  return {
    jobId: request.jobId,
    workspaceToken: request.workspaceToken,
    revision: request.revision,
    value: {
      engine: 'test',
      words: [{ id: text, text, start: 1, end: 2, muted: false }],
      speakers: {},
    },
  }
}

function installApi(initial: RendererSession) {
  let transcriptProgress!: Parameters<IElectronAPI['on']['transcriptProgress']>[0]
  let projectWillSwitch!: Parameters<IElectronAPI['on']['projectWillSwitch']>[0]
  let pendingProjectOpen!: Parameters<IElectronAPI['on']['pendingProjectOpen']>[0]
  const requests: Array<{
    request: Parameters<IElectronAPI['transcript']['generate']>[0]
    deferred: ReturnType<typeof deferred<SessionJobResult<Transcript, TranscriptionJobId>>>
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
    project: {
      initialize: vi.fn(async () => initial),
      openDialog,
      openPending,
      acknowledgeSwitch: vi.fn(async () => true),
      save: saveProject,
      saveAs: saveProjectAs,
    },
    audio: {
      selectImportFile: vi.fn(async () => null),
      startImport: vi.fn(),
      cancelImport: vi.fn(async () => 'not-found' as const),
    },
    transcript: {
      checkAvailability: vi.fn(async () => null),
      generate: vi.fn((request) => {
        const pending = deferred<SessionJobResult<Transcript, TranscriptionJobId>>()
        requests.push({ request, deferred: pending })
        return pending.promise
      }),
      cancel: vi.fn(async () => 'not-found' as const),
    },
    render: {
      startExport: vi.fn(),
      cancelExport: vi.fn(async () => 'not-found' as const),
    },
    on: {
      importProgress: vi.fn(() => vi.fn()),
      transcriptProgress: vi.fn((callback) => {
        transcriptProgress = callback
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
    progress: () => transcriptProgress,
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
    mocks.players.splice(0)
    const ids = ['job-a', 'job-b', 'job-c']
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => ids.shift()! as `${string}-${string}-${string}-${string}-${string}`,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('applies only the newest same-session result and merges current unrelated words', async () => {
    const { requests, progress } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    expect(requests).toHaveLength(2)

    act(() => {
      useTranscriptStore.getState().setWords([
        {
          id: 'intervening',
          text: 'intervening edit',
          start: 4,
          end: 5,
          muted: false,
          trackId: 'track-2',
          audioSourceId: SOURCE_A,
        },
      ])
      progress()({ ...requests[1].request, status: 'new job 50%' })
    })
    requests[1].deferred.resolve(result(requests[1].request, 'new'))
    await waitFor(() => expect(useTranscriptStore.getState().isGenerating).toBe(false))
    expect(useTranscriptStore.getState().words.map((word) => word.text)).toEqual([
      'new',
      'intervening edit',
    ])
    expect(useEditorStore.getState().localEditRevision).toBe(1)
    const acceptedState = {
      words: useTranscriptStore.getState().words,
      visible: useTranscriptStore.getState().visibleTrackIds,
      dirty: useEditorStore.getState().isDirty,
      revision: useEditorStore.getState().localEditRevision,
      draft: useEditorStore.getState().session?.draft,
      status: useTranscriptStore.getState().generatingStatus,
    }

    requests[0].deferred.resolve(result(requests[0].request, 'old'))
    await act(async () => Promise.resolve())
    expect({
      words: useTranscriptStore.getState().words,
      visible: useTranscriptStore.getState().visibleTrackIds,
      dirty: useEditorStore.getState().isDirty,
      revision: useEditorStore.getState().localEditRevision,
      draft: useEditorStore.getState().session?.draft,
      status: useTranscriptStore.getState().generatingStatus,
    }).toEqual(acceptedState)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not let an old finally or progress clear a newer running job', async () => {
    const { requests, progress } = await renderInitialized(session(TOKEN_A, 1, SOURCE_A, 'A'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    act(() => progress()({ ...requests[1].request, status: 'new job running' }))

    requests[0].deferred.reject(new Error('old failed'))
    await act(async () => Promise.resolve())
    act(() => progress()({ ...requests[0].request, status: 'old late progress' }))

    expect(useTranscriptStore.getState().isGenerating).toBe(true)
    expect(useTranscriptStore.getState().generatingStatus).toBe('new job running')
    expect(screen.queryByRole('alert')).toBeNull()
    requests[1].deferred.resolve(result(requests[1].request, 'new'))
    await waitFor(() => expect(useTranscriptStore.getState().isGenerating).toBe(false))
  })

  it('invalidates the job as soon as a successor session load starts', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const successor = session(TOKEN_B, 2, SOURCE_B, 'B')
    const { api, requests, progress } = await renderInitialized(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    act(() => progress()({ ...requests[0].request, status: 'old running' }))
    const prepareSuccessor = deferred<void>()
    mocks.registerAudioSource.mockImplementationOnce(() => prepareSuccessor.promise)
    api.project.openDialog.mockResolvedValueOnce({ outcome: 'switched', session: successor })

    fireEvent.click(screen.getByRole('button', { name: 'Open Project' }))
    await waitFor(() => expect(api.project.openDialog).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.registerAudioSource).toHaveBeenCalledTimes(2))
    expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_A)

    requests[0].deferred.resolve(result(requests[0].request, 'stale old'))
    await act(async () => Promise.resolve())
    expect(useTranscriptStore.getState().words.map((word) => word.text)).toEqual(['seed-A'])
    expect(useEditorStore.getState().isDirty).toBe(false)
    expect(useTranscriptStore.getState().visibleTrackIds).toEqual(['track-2'])
    expect(useTranscriptStore.getState().isGenerating).toBe(false)
    expect(useTranscriptStore.getState().generatingStatus).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()

    prepareSuccessor.resolve()
    await waitFor(() => expect(useEditorStore.getState().session?.workspaceToken).toBe(TOKEN_B))
    expect(useTranscriptStore.getState().words.map((word) => word.text)).toEqual(['seed-B'])
  })

  it.each([
    { button: 'Save', token: TOKEN_A, name: 'same-token revision advance' },
    { button: 'Save As', token: TOKEN_B, name: 'token replacement' },
  ])('invalidates a deferred job after Save applies a $name', async ({ button, token }) => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const saved = session(token, 2, SOURCE_A, 'Saved')
    const { api, requests, progress } = await renderInitialized(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    act(() => progress()({ ...requests[0].request, status: 'old running' }))
    if (button === 'Save') api.project.save.mockResolvedValueOnce(saved)
    else api.project.saveAs.mockResolvedValueOnce(saved)

    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(useEditorStore.getState().session?.revision).toBe(2))
    expect(useEditorStore.getState().session?.workspaceToken).toBe(token)
    expect(useTranscriptStore.getState().isGenerating).toBe(false)
    expect(useTranscriptStore.getState().generatingStatus).toBe('')
    const appliedState = {
      words: useTranscriptStore.getState().words,
      visible: useTranscriptStore.getState().visibleTrackIds,
      dirty: useEditorStore.getState().isDirty,
      revision: useEditorStore.getState().localEditRevision,
      draft: useEditorStore.getState().session?.draft,
    }

    act(() => progress()({ ...requests[0].request, status: 'stale progress' }))
    requests[0].deferred.reject(new Error('stale failure'))
    await act(async () => Promise.resolve())

    expect(useTranscriptStore.getState().isGenerating).toBe(false)
    expect(useTranscriptStore.getState().generatingStatus).toBe('')
    expect({
      words: useTranscriptStore.getState().words,
      visible: useTranscriptStore.getState().visibleTrackIds,
      dirty: useEditorStore.getState().isDirty,
      revision: useEditorStore.getState().localEditRevision,
      draft: useEditorStore.getState().session?.draft,
    }).toEqual(appliedState)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stops playback and invalidates async ownership before acknowledging a switch without clearing the visible project', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const { api, requests, progress, willSwitch } = await renderInitialized(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Generate transcript' }))
    act(() => progress()({ ...requests[0].request, status: 'running' }))

    await act(async () => {
      await willSwitch()({ transitionId: 'transition-a', workspaceToken: TOKEN_A, revision: 1 })
    })

    expect(useEditorStore.getState().session?.workspace.displayName).toBe('A')
    expect(useTranscriptStore.getState().isGenerating).toBe(false)
    expect(mocks.players[0].pause).toHaveBeenCalledTimes(1)
    expect(mocks.players[0].destroy).toHaveBeenCalledTimes(1)
    expect(api.project.acknowledgeSwitch).toHaveBeenCalledWith({
      transitionId: 'transition-a',
      workspaceToken: TOKEN_A,
      revision: 1,
    })

    requests[0].deferred.reject(new Error('late old failure'))
    await act(async () => Promise.resolve())
    expect(screen.queryByRole('alert')).toBeNull()
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
      draft: initial.draft,
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

  it('queues a forwarded open until the initial renderer session is ready', async () => {
    const initial = session(TOKEN_A, 1, SOURCE_A, 'A')
    const installed = installApi(initial)
    const initialization = deferred<RendererSession>()
    installed.api.project.initialize.mockReturnValueOnce(initialization.promise)
    render(<App />)
    await waitFor(() => expect(installed.api.on.pendingProjectOpen).toHaveBeenCalledTimes(1))

    await act(async () => {
      await installed.pendingOpen()({ requestId: 'early-request', displayName: 'Early' })
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
})
