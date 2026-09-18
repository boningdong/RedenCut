import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { ProjectMutationCoordinator } from '../project/ProjectMutationCoordinator'
import type { ProjectTransitionCoordinator } from '../project/ProjectTransitionCoordinator'
import type { SessionSwitchBarrier } from '../project/SessionSwitchBarrier'
import { SessionJobRegistry } from '../project/SessionJobRegistry'
import { WorkspaceController } from '../project/WorkspaceController'

const TOKEN = 'workspace-a' as WorkspaceToken
const roots: string[] = []
const request = {
  operationId: 'open-test',
  workspaceToken: TOKEN,
  revision: 3,
  isDirty: false as const,
}
const stayed: OpenProjectResult = {
  outcome: 'stayed',
  reason: 'cancelled',
  session: {
    workspaceToken: TOKEN,
    revision: 3,
    workspace: { kind: 'saved', displayName: 'Current', portable: true },
    sources: [],
    speechAnalyses: [],
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function mutationStub(): ProjectMutationCoordinator {
  return { save: vi.fn(), saveAs: vi.fn() } as unknown as ProjectMutationCoordinator
}

describe('project IPC', () => {
  beforeEach(() => mocks.handlers.clear())
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('routes dialog and pending opens through the same transition coordinator without returning paths', async () => {
    const coordinator = {
      openDialog: vi.fn(async () => stayed),
      openPath: vi.fn(async () => stayed),
    }
    const pending = { consume: vi.fn(() => '/private/Episode.redencut') }
    registerProjectIpc(
      { describe: vi.fn() } as unknown as WorkspaceController,
      coordinator as unknown as ProjectTransitionCoordinator,
      pending as unknown as PendingProjectOpenRegistry,
      { acknowledge: vi.fn() } as unknown as SessionSwitchBarrier,
      mutationStub(),
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
      '/private/Episode.redencut',
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
      mutationStub(),
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
      error: {
        code: 'invalid-request',
        reason: 'invalid-request',
        message: 'The request was invalid.',
      },
    })
  })

  it('acknowledges only barriers owned by the calling sender', async () => {
    const barrier = { acknowledge: vi.fn(() => true) }
    registerProjectIpc(
      { describe: vi.fn() } as unknown as WorkspaceController,
      { openDialog: vi.fn(), openPath: vi.fn() } as unknown as ProjectTransitionCoordinator,
      { consume: vi.fn() } as unknown as PendingProjectOpenRegistry,
      barrier as unknown as SessionSwitchBarrier,
      mutationStub(),
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

  it.each(['import', 'transcription', 'export', 'speech-analysis'] as const)(
    'preserves the ordinary Save lifecycle for an active %s job',
    async (kind) => {
      const parent = await mkdtemp(join(tmpdir(), 'redencut-project-ipc-'))
      roots.push(parent)
      const controller = new WorkspaceController()
      const initialized = await controller.initialize(parent)
      const current = await controller.saveAs(join(parent, 'Current.redencut'), {
        ...initialized,
        draft: initialized.draft,
      })
      const jobs = new SessionJobRegistry()
      let settleJob!: () => void
      const settled = new Promise<void>((resolve) => {
        settleJob = resolve
      })
      const cancel = vi.fn()
      jobs.register(
        {
          kind,
          jobId: `active-${kind}`,
          senderId: 7,
          workspaceToken: current.workspaceToken,
          revision: current.revision,
        },
        () => ({ cancel, settled }),
      )
      registerProjectIpc(
        controller,
        { openDialog: vi.fn(), openPath: vi.fn() } as unknown as ProjectTransitionCoordinator,
        { consume: vi.fn() } as unknown as PendingProjectOpenRegistry,
        { acknowledge: vi.fn() } as unknown as SessionSwitchBarrier,
        new ProjectMutationCoordinator(controller, jobs),
        vi.fn(),
      )

      const saving = mocks.handlers.get('project:save')!(
        { sender: sender() },
        { ...current, draft: current.draft },
      )
      if (kind === 'transcription' || kind === 'export') {
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
        let saveResolved = false
        void Promise.resolve(saving).then(() => {
          saveResolved = true
        })
        await Promise.resolve()
        expect(saveResolved).toBe(false)
        expect(() =>
          jobs.register(
            {
              kind: 'import',
              jobId: 'during-settlement',
              senderId: 7,
              workspaceToken: current.workspaceToken,
              revision: current.revision,
            },
            () => ({ cancel: vi.fn(), settled: Promise.resolve() }),
          ),
        ).toThrow('Session is closing')
        settleJob()
      }
      await expect(saving).resolves.toMatchObject({
        ok: true,
        value: { workspaceToken: current.workspaceToken, revision: current.revision + 1 },
      })
      if (kind === 'import' || kind === 'speech-analysis') expect(cancel).not.toHaveBeenCalled()
      expect(() =>
        jobs.register(
          {
            kind: 'import',
            jobId: 'late-import',
            senderId: 7,
            workspaceToken: current.workspaceToken,
            revision: current.revision + 1,
          },
          () => ({ cancel: vi.fn(), settled: Promise.resolve() }),
        ),
      ).not.toThrow()
      settleJob()
    },
  )

  it('settles jobs before Save As publication and releases an old temporary root only afterward', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-project-ipc-'))
    roots.push(parent)
    const controller = new WorkspaceController()
    const current = await controller.initialize(parent)
    const oldRoot = controller.workspace.root
    const destination = join(parent, 'Saved.redencut')
    const jobs = new SessionJobRegistry()
    const settled = deferred<void>()
    const cancel = vi.fn(async () => {
      await expect(stat(oldRoot)).resolves.toBeTruthy()
    })
    jobs.register(
      {
        kind: 'transcription',
        jobId: 'active-transcription',
        senderId: 7,
        workspaceToken: current.workspaceToken,
        revision: current.revision,
      },
      () => ({ cancel, settled: settled.promise }),
    )
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
    registerProjectIpc(
      controller,
      { openDialog: vi.fn(), openPath: vi.fn() } as unknown as ProjectTransitionCoordinator,
      { consume: vi.fn() } as unknown as PendingProjectOpenRegistry,
      { acknowledge: vi.fn() } as unknown as SessionSwitchBarrier,
      new ProjectMutationCoordinator(controller, jobs),
      vi.fn(),
    )

    const saving = mocks.handlers.get('project:save-as')!(
      { sender: sender() },
      {
        ...current,
        draft: current.draft,
      },
    )
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    await expect(stat(oldRoot)).resolves.toBeTruthy()
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })

    settled.resolve()
    await expect(saving).resolves.toMatchObject({
      ok: true,
      value: { revision: current.revision + 1, workspace: { kind: 'saved' } },
    })
    await expect(stat(oldRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(destination)).resolves.toBeTruthy()
  })
})

it.each([undefined, '', 12])(
  'rejects an invalid open operation identity (%s) before transition',
  async (operationId) => {
    const openDialog = vi.fn()
    registerProjectIpc(
      {} as WorkspaceController,
      { openDialog } as unknown as ProjectTransitionCoordinator,
      {} as PendingProjectOpenRegistry,
      {} as SessionSwitchBarrier,
      mutationStub(),
      vi.fn(),
    )
    await expect(
      mocks.handlers.get('project:open-dialog')!({ sender: sender() }, { ...request, operationId }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(openDialog).not.toHaveBeenCalled()
  },
)
