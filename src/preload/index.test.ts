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
