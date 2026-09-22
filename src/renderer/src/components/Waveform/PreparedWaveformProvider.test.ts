import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PreparedAudioAPI } from '@shared/PreparedAudioTypes'
import type { SessionPrecondition, WorkspaceToken } from '@shared/session.types'
import { PreparedWaveformProvider } from './PreparedWaveformProvider'

const state = vi.hoisted(() => ({ session: undefined as SessionPrecondition | undefined }))
vi.mock('../../stores/editor.store', () => ({
  useEditorStore: { getState: () => state },
}))

const session: SessionPrecondition = { workspaceToken: 'first' as WorkspaceToken, revision: 1 }
const buckets = [{ min: -0.25, max: 0.5 }]
const api = {
  prepare: vi.fn<PreparedAudioAPI['prepare']>(),
  waveform: vi.fn<PreparedAudioAPI['waveform']>(),
  read: vi.fn<PreparedAudioAPI['read']>(),
  release: vi.fn<PreparedAudioAPI['release']>(),
}
const range = () => ({
  sourceStartSeconds: 0,
  sourceEndSeconds: 1,
  targetPixelWidth: 100,
  signal: new AbortController().signal,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  state.session = { ...session }
  vi.stubGlobal('window', { electronAPI: { preparedAudio: api } })
  api.prepare.mockResolvedValue({ handle: 'prepared', channels: 2, frameCount: 96000 })
  api.waveform.mockResolvedValue({ buckets, peak: 0.875 })
  api.release.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

it('prepares timeline coordinates and clamps frame ranges and bucket counts', async () => {
  const provider = new PreparedWaveformProvider(session)
  await provider.prepare([], 'track')
  expect(api.prepare).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'timeline', trackId: 'track' }),
  )
  expect(api.waveform).toHaveBeenCalledWith(
    expect.objectContaining({ startFrame: 0, endFrame: 96000, targetBuckets: 1 }),
  )
  expect(await provider.getPeak()).toBe(0.875)
  expect(
    await provider.readRange({
      ...range(),
      sourceStartSeconds: 0.10001,
      sourceEndSeconds: 0.20001,
      targetPixelWidth: 10.25,
    }),
  ).toEqual({ buckets })
  expect(api.waveform).toHaveBeenLastCalledWith(
    expect.objectContaining({ startFrame: 4800, endFrame: 9601, targetBuckets: 11 }),
  )
  await provider.readRange({
    ...range(),
    sourceStartSeconds: -10,
    sourceEndSeconds: 10,
    targetPixelWidth: 100000,
  })
  expect(api.waveform).toHaveBeenLastCalledWith(
    expect.objectContaining({ startFrame: 0, endFrame: 96000, targetBuckets: 4096 }),
  )
  await provider.readRange({ ...range(), targetPixelWidth: 0 })
  expect(api.waveform).toHaveBeenLastCalledWith(expect.objectContaining({ targetBuckets: 1 }))
  api.waveform.mockClear()
  expect(
    await provider.readRange({ ...range(), sourceStartSeconds: 3, sourceEndSeconds: 4 }),
  ).toEqual({ buckets: [] })
  expect(api.waveform).not.toHaveBeenCalled()
})

it('releases only its independent display lease and leaves another provider usable', async () => {
  const first = new PreparedWaveformProvider(session)
  const second = new PreparedWaveformProvider(session)
  await Promise.all([first.prepare([], 'same'), second.prepare([], 'same')])
  const [firstRequest, secondRequest] = api.prepare.mock.calls.map(([request]) => request)
  expect(firstRequest.requestId).not.toBe(secondRequest.requestId)
  await first.dispose()
  expect(api.release).toHaveBeenCalledExactlyOnceWith({
    ...session,
    requestId: firstRequest.requestId,
  })
  await expect(first.readRange(range())).rejects.toMatchObject({ name: 'AbortError' })
  expect(await second.readRange(range())).toEqual({ buckets })
  expect(api.waveform).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: secondRequest.requestId }),
  )
})

it('retries stale admission with the current revision of the same workspace', async () => {
  api.prepare.mockImplementationOnce(async () => {
    state.session = { ...session, revision: 2 }
    throw new Error('stale revision')
  })
  const provider = new PreparedWaveformProvider(session)
  await provider.prepare([], 'track')
  expect(api.prepare.mock.calls.map(([request]) => request.revision)).toEqual([1, 2])
  expect(api.waveform).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2 }))
  expect(await provider.getPeak()).toBe(0.875)
})

it('bounds revision retries and does not retry an unchanged failing revision', async () => {
  const failure = new Error('admission failed')
  api.prepare.mockImplementation(async () => {
    state.session = { ...session, revision: state.session!.revision + 1 }
    throw failure
  })
  await expect(new PreparedWaveformProvider(session).prepare([], 'track')).rejects.toBe(failure)
  expect(api.prepare.mock.calls.map(([request]) => request.revision)).toEqual([1, 2, 3])
  api.prepare.mockClear().mockRejectedValue(failure)
  await expect(new PreparedWaveformProvider(session).prepare([], 'track')).rejects.toBe(failure)
  expect(api.prepare).toHaveBeenCalledTimes(1)
})

it('cancels revision retry when the workspace changes', async () => {
  api.prepare.mockImplementationOnce(async () => {
    state.session = { workspaceToken: 'second' as WorkspaceToken, revision: 2 }
    throw new Error('old workspace')
  })
  await expect(new PreparedWaveformProvider(session).prepare([], 'track')).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(api.prepare).toHaveBeenCalledTimes(1)
  expect(api.waveform).not.toHaveBeenCalled()
})

it('releases late preparation after disposal and never starts its peak read', async () => {
  const pending = deferred<Awaited<ReturnType<PreparedAudioAPI['prepare']>>>()
  api.prepare.mockReturnValueOnce(pending.promise)
  const provider = new PreparedWaveformProvider(session)
  const preparing = provider.prepare([], 'track')
  const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
  await provider.dispose()
  pending.resolve({ handle: 'late', channels: 1, frameCount: 48000 })
  await rejected
  expect(api.release).toHaveBeenCalledTimes(2)
  expect(api.release.mock.calls[0][0].requestId).toBe(api.release.mock.calls[1][0].requestId)
  expect(api.waveform).not.toHaveBeenCalled()
})

it('discards a range response after its caller aborts', async () => {
  const provider = new PreparedWaveformProvider(session)
  await provider.prepare([], 'track')
  const pending = deferred<Awaited<ReturnType<PreparedAudioAPI['waveform']>>>()
  api.waveform.mockReturnValueOnce(pending.promise)
  const controller = new AbortController()
  const reading = provider.readRange({ ...range(), signal: controller.signal })
  controller.abort()
  pending.resolve({ buckets, peak: 0.875 })
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
})

it('discards a successful range response after its workspace changes', async () => {
  const provider = new PreparedWaveformProvider(session)
  await provider.prepare([], 'track')
  const pending = deferred<Awaited<ReturnType<PreparedAudioAPI['waveform']>>>()
  api.waveform.mockReturnValueOnce(pending.promise)
  const reading = provider.readRange(range())
  state.session = { workspaceToken: 'second' as WorkspaceToken, revision: 1 }
  pending.resolve({ buckets, peak: 0.875 })
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
})
