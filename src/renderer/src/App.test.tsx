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
}))

vi.mock('./audio/WorkletAudioPlayer', () => ({
  WorkletAudioPlayer: class {
    registerAudioSource = mocks.registerAudioSource
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
  const requests: Array<{
    request: Parameters<IElectronAPI['transcript']['generate']>[0]
    deferred: ReturnType<typeof deferred<SessionJobResult<Transcript, TranscriptionJobId>>>
  }> = []
  const openDialog = vi.fn<IElectronAPI['project']['openDialog']>(async () => null)
  const api = {
    project: {
      initialize: vi.fn(async () => initial),
      openDialog,
      save: vi.fn(async () => null),
      saveAs: vi.fn(async () => null),
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
    render: { export: vi.fn() },
    on: {
      importProgress: vi.fn(() => vi.fn()),
      transcriptProgress: vi.fn((callback) => {
        transcriptProgress = callback
        return vi.fn()
      }),
      renderProgress: vi.fn(() => vi.fn()),
    },
  } satisfies IElectronAPI
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  return { api, requests, progress: () => transcriptProgress }
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
    api.project.openDialog.mockResolvedValueOnce(successor)

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
})
