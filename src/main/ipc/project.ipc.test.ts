import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenProjectResult } from '../../shared/session.types'
import type { WorkspaceToken } from '../../shared/session.types'

type IpcHandler = (...args: unknown[]) => unknown
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []), getFocusedWindow: vi.fn(() => ({})) },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => mocks.handlers.set(channel, handler),
  },
}))

import { registerProjectIpc } from './project.ipc'
import type { PendingProjectOpenRegistry } from '../project/PendingProjectOpenRegistry'
import type { ProjectTransitionCoordinator } from '../project/ProjectTransitionCoordinator'
import type { SessionSwitchBarrier } from '../project/SessionSwitchBarrier'
import type { WorkspaceController } from '../project/WorkspaceController'

const TOKEN = 'workspace-a' as WorkspaceToken
const request = { workspaceToken: TOKEN, revision: 3, isDirty: false as const }
const stayed: OpenProjectResult = {
  outcome: 'stayed',
  reason: 'cancelled',
  session: {
    workspaceToken: TOKEN,
    revision: 3,
    workspace: { kind: 'saved', displayName: 'Current', portable: true },
    sources: [],
    draft: {
      tracks: [],
      export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48_000 },
    },
  },
}

function sender(id = 7) {
  return {
    id,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    removeListener: vi.fn(),
  }
}

describe('project IPC', () => {
  beforeEach(() => mocks.handlers.clear())

  it('routes dialog and pending opens through the same transition coordinator without returning paths', async () => {
    const coordinator = {
      openDialog: vi.fn(async () => stayed),
      openPath: vi.fn(async () => stayed),
    }
    const pending = { consume: vi.fn(() => '/private/Episode.podcut') }
    registerProjectIpc(
      { describe: vi.fn() } as unknown as WorkspaceController,
      coordinator as unknown as ProjectTransitionCoordinator,
      pending as unknown as PendingProjectOpenRegistry,
      { acknowledge: vi.fn() } as unknown as SessionSwitchBarrier,
      vi.fn(),
    )
    const ownedSender = sender()

    const dialogResult = await mocks.handlers.get('project:open-dialog')!(
      { sender: ownedSender },
      request,
    )
    const pendingResult = await mocks.handlers.get('project:open-pending')!(
      { sender: ownedSender },
      { ...request, requestId: 'opaque-request' },
    )

    expect(coordinator.openDialog).toHaveBeenCalledWith(ownedSender, request)
    expect(pending.consume).toHaveBeenCalledWith(7, 'opaque-request')
    expect(coordinator.openPath).toHaveBeenCalledWith(
      ownedSender,
      request,
      '/private/Episode.podcut',
    )
    expect(JSON.stringify([dialogResult, pendingResult])).not.toContain('/private')
  })

  it('rejects invalid dirty requests and wrong pending identifiers with safe errors', async () => {
    const coordinator = { openDialog: vi.fn(), openPath: vi.fn() }
    const pending = {
      consume: vi.fn(() => {
        throw new Error('Pending project request is invalid')
      }),
    }
    registerProjectIpc(
      { describe: vi.fn() } as unknown as WorkspaceController,
      coordinator as unknown as ProjectTransitionCoordinator,
      pending as unknown as PendingProjectOpenRegistry,
      { acknowledge: vi.fn() } as unknown as SessionSwitchBarrier,
      vi.fn(),
    )

    await expect(
      mocks.handlers.get('project:open-dialog')!(
        { sender: sender() },
        { ...request, isDirty: true },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    await expect(
      mocks.handlers.get('project:open-pending')!(
        { sender: sender() },
        { ...request, requestId: 'wrong' },
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'The request was invalid.' },
    })
  })

  it('acknowledges only barriers owned by the calling sender', async () => {
    const barrier = { acknowledge: vi.fn(() => true) }
    registerProjectIpc(
      { describe: vi.fn() } as unknown as WorkspaceController,
      { openDialog: vi.fn(), openPath: vi.fn() } as unknown as ProjectTransitionCoordinator,
      { consume: vi.fn() } as unknown as PendingProjectOpenRegistry,
      barrier as unknown as SessionSwitchBarrier,
      vi.fn(),
    )
    const acknowledgement = {
      workspaceToken: TOKEN,
      revision: 3,
      transitionId: 'opaque-transition',
    }

    await expect(
      mocks.handlers.get('project:acknowledge-switch')!({ sender: sender(9) }, acknowledgement),
    ).resolves.toEqual({ ok: true, value: true })
    expect(barrier.acknowledge).toHaveBeenCalledWith(9, acknowledgement)
  })
})
