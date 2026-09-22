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
