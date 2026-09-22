import { DEFAULT_WORKSPACE_LAYOUT as layout } from '../shared/workspaceLayout.types'
import { expect, test, vi } from 'vitest'
import type { IElectronAPI, PendingProjectOpenEvent } from '../shared/ipc.types'
import type { WorkspaceToken } from '../shared/session.types'

const mocks = vi.hoisted(() => ({
  api: null as IElectronAPI | null,
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: IElectronAPI) => {
      mocks.api = api
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: (channel: string, listener: (...args: unknown[]) => void) =>
      mocks.listeners.set(channel, listener),
    off: vi.fn(),
  },
}))

import './index'

test('buffers an early pending project until the renderer subscribes', async () => {
  const event: PendingProjectOpenEvent = { requestId: 'opaque-request', displayName: 'Episode' }
  mocks.listeners.get('project:pending-open')!({}, event)
  const received: PendingProjectOpenEvent[] = []

  mocks.api!.on.pendingProjectOpen(async (pending) => {
    received.push(pending)
  })

  expect(received).toEqual([event])
  expect(JSON.stringify(received)).not.toContain('/private')
})

test('workspace preferences forward exact channels and unwrap successful results', async () => {
  const { ipcRenderer } = await import('electron')
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
    ok: true,
    value: { layout, warning: null },
  })
  expect(await mocks.api!.workspaceLayout.get()).toEqual({ layout, warning: null })
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('workspace-layout:get')
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: layout })
  expect(await mocks.api!.workspaceLayout.set(layout)).toEqual(layout)
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('workspace-layout:set', layout)
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
    ok: false,
    error: { code: 'operation-failed', message: 'Could not save.' },
  })
  await expect(mocks.api!.workspaceLayout.set(layout)).rejects.toMatchObject({
    code: 'operation-failed',
  })
})

test('app preferences unwrap get/set results and unsubscribe the exact changed listener', async () => {
  const { ipcRenderer } = await import('electron')
  const snapshot = {
    preference: 'zh-CN' as const,
    resolvedLocale: 'zh-CN' as const,
    revision: 1,
    warning: null,
  }
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: snapshot })
  expect(await mocks.api!.appPreferences.get()).toEqual(snapshot)
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('app-preferences:get')
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: snapshot })
  expect(await mocks.api!.appPreferences.setLocale('zh-CN')).toEqual(snapshot)
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('app-preferences:set-locale', 'zh-CN')
  const listener = vi.fn()
  const unsubscribe = mocks.api!.appPreferences.onChanged(listener)
  const handler = mocks.listeners.get('app-preferences:changed')!
  handler({}, snapshot)
  expect(listener).toHaveBeenCalledWith(snapshot)
  unsubscribe()
  expect(ipcRenderer.off).toHaveBeenLastCalledWith('app-preferences:changed', handler)
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
    ok: false,
    error: { code: 'operation-failed', message: 'Could not save.' },
  })
  await expect(mocks.api!.appPreferences.setLocale('en')).rejects.toMatchObject({
    code: 'operation-failed',
  })
})

test('prepared audio progress forwards its session-scoped request and unwraps the result', async () => {
  const { ipcRenderer } = await import('electron')
  const request = {
    workspaceToken: 'workspace' as WorkspaceToken,
    revision: 1,
    requestId: 'lease',
  }
  const progress = { phase: 'waveform', completed: 12, total: 20 }
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: progress })
  expect(await mocks.api!.preparedAudio.progress(request)).toEqual(progress)
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('effects:progress', request)
})
