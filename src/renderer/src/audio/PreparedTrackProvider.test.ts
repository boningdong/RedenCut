import { afterEach, expect, it, vi } from 'vitest'
import type { RendererSession, WorkspaceToken } from '@shared/session.types'
import { PreparedTrackProvider } from './PreparedTrackProvider'
import { useEditorStore } from '../stores/editor.store'

const session = (revision: number, workspaceToken = 'workspace') =>
  ({ workspaceToken: workspaceToken as WorkspaceToken, revision }) as RendererSession

afterEach(() => {
  vi.unstubAllGlobals()
  useEditorStore.setState({ session: null })
})

it('retries preparation admission when an ordinary save advances the same workspace revision', async () => {
  useEditorStore.setState({ session: session(1) })
  let reject!: (error: Error) => void
  const prepare = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    .mockResolvedValue({ handle: 'ready', channels: 1, frameCount: 48000 })
  vi.stubGlobal('window', { electronAPI: { preparedAudio: { prepare, release: vi.fn() } } })
  const provider = new PreparedTrackProvider()
  const result = provider.prepare([], 'track', 'timeline')
  useEditorStore.setState({ session: session(2) })
  reject(new Error('Stale workspace revision'))
  expect((await result).frameCount).toBe(48000)
  expect(prepare).toHaveBeenCalledTimes(2)
  expect(prepare.mock.calls[1][0].revision).toBe(2)
  await provider.dispose()
})

it('never retries an old composition into a different workspace', async () => {
  useEditorStore.setState({ session: session(1) })
  let reject!: (error: Error) => void
  const prepare = vi.fn(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  vi.stubGlobal('window', { electronAPI: { preparedAudio: { prepare, release: vi.fn() } } })
  const provider = new PreparedTrackProvider()
  const result = provider.prepare([], 'track', 'timeline')
  useEditorStore.setState({ session: session(1, 'other-workspace') })
  reject(new Error('Project changed'))
  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  expect(prepare).toHaveBeenCalledTimes(1)
  await provider.dispose()
})

it('preserves managed-runtime guidance as an Error through playback error callbacks', async () => {
  useEditorStore.setState({ session: session(1) })
  const prepare = vi.fn().mockRejectedValue({
    code: 'operation-failed',
    reason: 'runtime-unavailable',
    message: 'The managed runtime is missing or invalid.',
  })
  vi.stubGlobal('window', { electronAPI: { preparedAudio: { prepare, release: vi.fn() } } })
  const provider = new PreparedTrackProvider()
  const error = await provider.prepare([], 'track', 'timeline').catch((error) => error)
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ reason: 'runtime-unavailable' })
  await provider.dispose()
})

it('keeps public reasons on prepared reads without leaking unknown IPC fields', async () => {
  useEditorStore.setState({ session: session(1) })
  const prepare = vi.fn().mockResolvedValue({ handle: 'ready', channels: 1, frameCount: 48000 })
  const read = vi.fn().mockRejectedValue({
    code: 'operation-failed',
    reason: 'stale-session',
    message: '/private/diagnostic',
    privatePath: '/private/diagnostic',
  })
  vi.stubGlobal('window', { electronAPI: { preparedAudio: { prepare, read, release: vi.fn() } } })
  const provider = new PreparedTrackProvider()
  const samples = await provider.prepare([], 'track', 'timeline')
  const error = await samples
    .readFrames(0, 100, new AbortController().signal)
    .catch((error) => error)
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ reason: 'stale-session' })
  expect(error.message).not.toContain('/private')
  expect(error).not.toHaveProperty('privatePath')
  await provider.dispose()
})

it('keeps independent track leases readable concurrently and releases every lease', async () => {
  useEditorStore.setState({ session: session(1) })
  const leases = new Map<string, string>()
  const prepare = vi.fn(async ({ requestId, trackId }: { requestId: string; trackId: string }) => {
    leases.set(requestId, trackId)
    return { handle: trackId, channels: 1, frameCount: 48000 }
  })
  const read = vi.fn(async ({ requestId, handle }: { requestId: string; handle: string }) => {
    if (leases.get(requestId) !== handle) throw new Error('Unknown prepared audio handle')
    return {
      startFrame: 0,
      frameCount: 1,
      channels: [new Float32Array([handle === 'first' ? 0.25 : 0.5])],
    }
  })
  const release = vi.fn(async ({ requestId }: { requestId: string }) => {
    leases.delete(requestId)
  })
  vi.stubGlobal('window', { electronAPI: { preparedAudio: { prepare, read, release } } })
  const provider = new PreparedTrackProvider()
  const [first, second] = await Promise.all([
    provider.prepare([], 'first', 'timeline'),
    provider.prepare([], 'second', 'timeline'),
  ])
  const signal = new AbortController().signal
  expect((await first.readFrames(0, 1, signal)).channels[0][0]).toBe(0.25)
  expect((await second.readFrames(0, 1, signal)).channels[0][0]).toBe(0.5)
  await provider.dispose()
  expect(leases.size).toBe(0)
})

it('releases removed tracks and rejects their late preparation before they can attach', async () => {
  useEditorStore.setState({ session: session(1) })
  const pending: Array<(value: { handle: string; channels: number; frameCount: number }) => void> =
    []
  const live = new Set<string>()
  const prepare = vi.fn(({ requestId }: { requestId: string }) => {
    live.add(requestId)
    return new Promise<{ handle: string; channels: number; frameCount: number }>((resolve) =>
      pending.push(resolve),
    )
  })
  const release = vi.fn(async ({ requestId }: { requestId: string }) => {
    live.delete(requestId)
  })
  vi.stubGlobal('window', { electronAPI: { preparedAudio: { prepare, release } } })
  const provider = new PreparedTrackProvider()
  const obsolete = provider.prepare([], 'first', 'timeline')
  const rejected = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
  await provider.retainTracks([])
  const current = provider.prepare([], 'first', 'timeline')
  pending[0]({ handle: 'old', channels: 1, frameCount: 48000 })
  await rejected
  pending[1]({ handle: 'new', channels: 1, frameCount: 48000 })
  expect((await current).frameCount).toBe(48000)
  expect(live.size).toBe(1)
  await provider.retainTracks([])
  expect(live.size).toBe(0)
  await provider.dispose()
})
