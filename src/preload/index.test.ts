import { DEFAULT_WORKSPACE_LAYOUT as layout } from '../shared/workspaceLayout.types'
import { expect, test, vi } from 'vitest'
import type { IElectronAPI, PendingProjectOpenEvent } from '../shared/ipc.types'

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
