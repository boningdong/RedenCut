import { EventEmitter } from 'node:events'
import { RuntimeValidationError } from '../runtime/RuntimeValidator'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WorkspaceController } from '../project/WorkspaceController'
import { SessionJobRegistry } from '../project/SessionJobRegistry'
import type { WorkspaceToken } from '../../shared/session.types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  prepare: vi.fn(),
  read: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
}))
vi.mock('../audio/effects/PreparedTrackService', () => ({
  PreparedTrackService: class {
    prepare = mocks.prepare
    read = mocks.read
    dispose = mocks.dispose
  },
}))
import { registerPreparedAudioIpc } from './PreparedAudioIpc'

const token = 'workspace' as WorkspaceToken
function setup() {
  const jobs = new SessionJobRegistry()
  const controller = {
    assertCurrent: vi.fn(),
    captureOriginalResolver: vi.fn(() => vi.fn()),
    workspace: {
      project: {
        version: 4,
        createdAt: 'now',
        audioSettings: { processingSampleRate: 48000 },
        audioSources: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            displayName: 'source',
            location: {
              mode: 'copy',
              path: 'media/00000000-0000-4000-8000-000000000001/source.wav',
            },
            fingerprint: { sha256: 'a'.repeat(64), byteLength: 10, modifiedTimeMs: 0 },
            metadata: {
              channels: 1,
              durationSeconds: 1,
              sampleRate: 48000,
              codec: 'pcm',
              bitrateKbps: 1536,
            },
          },
        ],
      },
    },
  }
  registerPreparedAudioIpc(controller as unknown as WorkspaceController, jobs)
  const sender = Object.assign(new EventEmitter(), { id: 1 })
  const request = {
    workspaceToken: token,
    revision: 1,
    requestId: 'lease',
    mode: 'timeline',
    trackId: 'track',
    tracks: [
      {
        id: 'track',
        name: 'Track',
        effects: [
          {
            id: 'normalize',
            type: 'normalize',
            enabled: true,
            params: { targetLufs: -16, truePeakDbtp: -1.5, loudnessRange: 7 },
          },
        ],
        clips: [
          {
            id: 'clip',
            trackId: 'track',
            audioSourceId: '00000000-0000-4000-8000-000000000001',
            sourceStart: 0,
            sourceEnd: 1,
            outputStart: 0,
            gain: 1,
            muted: false,
            effects: [],
          },
        ],
        volume: 1,
        muted: false,
        solo: false,
        color: '#fff',
      },
    ],
  }
  return {
    jobs,
    controller,
    sender,
    request,
    call: (name: string, input: unknown = request, senderOverride: unknown = sender) =>
      mocks.handlers.get(`effects:${name}`)!({ sender: senderOverride }, input),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockResolvedValue({ handle: 'handle', channels: 1, frameCount: 48000 })
  mocks.dispose.mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

it('rejects malformed settings and stale sessions before preparation', async () => {
  const f = setup()
  expect(
    await f.call('prepare', {
      ...f.request,
      tracks: [{ ...f.request.tracks[0], gainDb: Infinity }],
    }),
  ).toMatchObject({ ok: false })
  expect(mocks.prepare).not.toHaveBeenCalled()
  f.controller.assertCurrent.mockImplementation(() => {
    throw new Error('stale')
  })
  expect(await f.call('prepare')).toMatchObject({ ok: false })
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it('binds handles to sender/session and cleans ready artifacts on project closing', async () => {
  const f = setup()
  expect(await f.call('prepare')).toMatchObject({ ok: true, value: { handle: 'handle' } })
  const read = {
    workspaceToken: token,
    revision: 1,
    requestId: 'lease',
    handle: 'handle',
    startFrame: 0,
    frameCount: 100,
  }
  expect(await f.call('read', read, Object.assign(new EventEmitter(), { id: 2 }))).toMatchObject({
    ok: false,
  })
  expect(mocks.read).not.toHaveBeenCalled()
  mocks.read.mockResolvedValue({
    startFrame: 0,
    frameCount: 100,
    channels: [new Float32Array(100)],
  })
  expect(await f.call('read', read)).toMatchObject({ ok: true })
  f.jobs.beginClosing(token)
  await f.jobs.cancelAndSettleToken(token)
  expect(mocks.dispose).toHaveBeenCalledTimes(1)
  expect(await f.call('read', read)).toMatchObject({ ok: false })
})
it('disposes the admitted lease when the owning renderer is destroyed', async () => {
  const f = setup()
  await f.call('prepare')
  f.sender.emit('destroyed')
  await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledTimes(1))
})

it('rejects unknown sources, duplicate tracks, and invalid linked children before rendering', async () => {
  const f = setup()
  for (const tracks of [
    [f.request.tracks[0], f.request.tracks[0]],
    [{ ...f.request.tracks[0], mixLink: { stemTrackIds: ['missing'] } }],
    [
      {
        ...f.request.tracks[0],
        clips: [
          {
            ...f.request.tracks[0].clips[0],
            audioSourceId: '00000000-0000-4000-8000-000000000002',
          },
        ],
      },
    ],
  ])
    expect(await f.call('prepare', { ...f.request, tracks })).toMatchObject({ ok: false })
  expect(mocks.prepare).not.toHaveBeenCalled()
})

it('keeps admitted preparation and reads valid across ordinary saves of the same workspace', async () => {
  const f = setup()
  let finish!: (value: unknown) => void
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const preparing = f.call('prepare')
  f.controller.assertCurrent.mockImplementation(() => {
    throw new Error('Stale workspace revision')
  })
  finish({ handle: 'handle', channels: 1, frameCount: 48000 })
  expect(await preparing).toMatchObject({ ok: true })
  mocks.read.mockResolvedValue({ startFrame: 0, frameCount: 1, channels: [new Float32Array(1)] })
  const request = { ...f.request, handle: 'handle', startFrame: 0, frameCount: 1 }
  expect(await f.call('read', request)).toMatchObject({ ok: true })
  f.controller.workspace = { ...f.controller.workspace }
  expect(await f.call('read', request)).toMatchObject({ ok: false })
})

it('returns public managed-runtime guidance when Normalize cannot resolve FFmpeg', async () => {
  const f = setup()
  mocks.prepare.mockRejectedValueOnce(new RuntimeValidationError('ffmpeg', 'missing'))
  expect(await f.call('prepare')).toMatchObject({
    ok: false,
    error: { code: 'operation-failed', reason: 'runtime-unavailable' },
  })
})
