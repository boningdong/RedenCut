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
  waveform: vi.fn(),
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
    waveform = mocks.waveform
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

it('prepares a raw composite and keeps waveform handles bound to their consumer lease', async () => {
  const f = setup()
  const raw = {
    ...f.request,
    requestId: 'waveform',
    tracks: [{ ...f.request.tracks[0], effects: [] }],
  }
  expect(await f.call('prepare', raw)).toMatchObject({ ok: true })
  mocks.waveform.mockResolvedValue({ buckets: [{ min: -0.5, max: 0.5 }], peak: 0.75 })
  const read = { ...raw, handle: 'handle', startFrame: 0, endFrame: 48000, targetBuckets: 1 }
  expect(await f.call('waveform', read)).toEqual({
    ok: true,
    value: { buckets: [{ min: -0.5, max: 0.5 }], peak: 0.75 },
  })
  expect(await f.call('waveform', { ...read, requestId: 'playback' })).toMatchObject({ ok: false })
  await f.call('release', raw)
  expect(await f.call('waveform', read)).toMatchObject({ ok: false })
})

it('shares playback/waveform preparation and reports lease-scoped progress', async () => {
  const f = setup()
  let finish!: (value: unknown) => void
  mocks.prepare.mockImplementationOnce((_plan, _mode, _sources, _resolver, onProgress) => {
    onProgress({ phase: 'processing', completed: 123, total: 48000 })
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const first = f.call('prepare')
  const secondRequest = { ...f.request, requestId: 'waveform', mode: 'edited' }
  const second = f.call('prepare', secondRequest)
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
  expect(await f.call('progress', secondRequest)).toMatchObject({
    ok: true,
    value: { phase: 'processing', completed: 123, total: 48000 },
  })
  expect(
    await f.call('progress', secondRequest, Object.assign(new EventEmitter(), { id: 2 })),
  ).toEqual({ ok: true, value: null })
  await f.call('release')
  expect(mocks.dispose).not.toHaveBeenCalled()
  finish({ handle: 'handle', channels: 1, frameCount: 48000 })
  expect(await first).toMatchObject({ ok: false })
  expect(await second).toMatchObject({ ok: true })
  expect(await f.call('progress')).toEqual({ ok: true, value: null })
  await f.call('release', secondRequest)
  expect(mocks.dispose).not.toHaveBeenCalled()
  await f.jobs.cancelAndSettleToken(token)
  expect(mocks.dispose).toHaveBeenCalledTimes(1)
})

it('denies reading a handle belonging to another live lease in the same sender', async () => {
  const f = setup()
  await f.call('prepare')
  const other = {
    ...f.request,
    requestId: 'other',
    tracks: [{ ...f.request.tracks[0], effects: [] }],
  }
  mocks.prepare.mockResolvedValueOnce({ handle: 'other-handle', channels: 1, frameCount: 48000 })
  await f.call('prepare', other)
  expect(
    await f.call('read', { ...f.request, handle: 'other-handle', startFrame: 0, frameCount: 1 }),
  ).toMatchObject({ ok: false })
  expect(
    await f.call('waveform', {
      ...f.request,
      handle: 'other-handle',
      startFrame: 0,
      endFrame: 1,
      targetBuckets: 1,
    }),
  ).toMatchObject({ ok: false })
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.waveform).not.toHaveBeenCalled()
  await f.jobs.cancelAndSettleSender(1)
  expect(mocks.dispose).toHaveBeenCalledTimes(2)
})

it('destroys cached idle artifacts when the sender disappears', async () => {
  const f = setup()
  await f.call('prepare')
  await f.call('release')
  expect(mocks.dispose).not.toHaveBeenCalled()
  f.sender.emit('destroyed')
  await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledTimes(1))
  expect(await f.call('progress')).toEqual({ ok: true, value: null })
})

it('keeps a replacement request alive after an obsolete pending job completes', async () => {
  const f = setup()
  let finish!: (value: unknown) => void
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const old = f.call('prepare')
  await f.call('release')
  mocks.prepare.mockResolvedValueOnce({ handle: 'new-handle', channels: 1, frameCount: 48000 })
  expect(await f.call('prepare')).toMatchObject({ ok: true, value: { handle: 'new-handle' } })
  finish({ handle: 'old-handle', channels: 1, frameCount: 48000 })
  expect(await old).toMatchObject({ ok: false })
  expect(await f.call('progress')).toMatchObject({ ok: true, value: { phase: 'waveform' } })
  await f.jobs.cancelAndSettleToken(token)
})

it('rejects new consumers of an existing pool after workspace closing starts', async () => {
  const f = setup()
  await f.call('prepare')
  f.jobs.beginClosing(token)
  expect(await f.call('prepare', { ...f.request, requestId: 'late' })).toMatchObject({ ok: false })
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
  await f.jobs.cancelAndSettleToken(token)
  expect(mocks.dispose).toHaveBeenCalledTimes(1)
})
