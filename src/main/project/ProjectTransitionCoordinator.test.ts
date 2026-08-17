import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from '../../shared/project.types'
import type { OpenProjectRequest, RendererSession } from '../../shared/session.types'
import { ProjectWorkspace } from './ProjectWorkspace'
import { ProjectTransitionCoordinator } from './ProjectTransitionCoordinator'
import { SessionJobRegistry } from './SessionJobRegistry'
import { ProjectSwitchShutdownError } from './SessionSwitchBarrier'
import { WorkspaceController } from './WorkspaceController'

function sender(id = 7) {
  return {
    id,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    removeListener: vi.fn(),
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function request(session: RendererSession, isDirty = false): OpenProjectRequest {
  return isDirty ? { ...session, isDirty, draft: session.draft } : { ...session, isDirty }
}

async function packageRoot(parent: string, name: string): Promise<string> {
  const root = join(parent, name)
  await mkdir(root)
  await writeFile(join(root, 'project.json'), JSON.stringify(createEmptyProject(), null, 2))
  return root
}

function harness(controller: WorkspaceController, overrides: Record<string, unknown> = {}) {
  const jobs = {
    beginClosing: vi.fn(),
    reopen: vi.fn(),
    cancelAndSettleToken: vi.fn(async () => {}),
  }
  const barrier = { wait: vi.fn(async () => {}) }
  const dependencies = {
    controller,
    jobs: jobs as unknown as SessionJobRegistry,
    barrier,
    chooseDirtyAction: vi.fn(async () => 'discard' as const),
    chooseSaveDestination: vi.fn(async () => null as string | null),
    chooseOpenDestination: vi.fn(async () => null as string | null),
    ...overrides,
  }
  return {
    coordinator: new ProjectTransitionCoordinator(dependencies),
    jobs,
    barrier,
    dependencies,
  }
}

describe('ProjectTransitionCoordinator', () => {
  it('keeps the exact current session for dirty Cancel and temporary Save As cancellation', async () => {
    const controller = new WorkspaceController()
    const current = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-transition-')))
    const cancelled = harness(controller, {
      chooseDirtyAction: vi.fn(async () => 'cancel' as const),
    })
    await expect(
      cancelled.coordinator.openDialog(sender(), request(current, true)),
    ).resolves.toEqual({
      outcome: 'stayed',
      session: current,
      reason: 'cancelled',
    })

    const saveCancelled = harness(controller, {
      chooseDirtyAction: vi.fn(async () => 'save' as const),
      chooseSaveDestination: vi.fn(async () => null),
    })
    await expect(
      saveCancelled.coordinator.openDialog(sender(), request(current, true)),
    ).resolves.toEqual({
      outcome: 'stayed',
      session: current,
      reason: 'cancelled',
    })
  })

  it('reports save failure without selecting or preparing a candidate', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const initial = await controller.initialize(parent)
    const current = await controller.saveAs(join(parent, 'Current.podcut'), {
      ...initial,
      draft: initial.draft,
    })
    vi.spyOn(ProjectWorkspace.prototype, 'save').mockRejectedValueOnce(new Error('disk failed'))
    const candidate = await packageRoot(parent, 'Candidate.podcut')
    const { coordinator, dependencies } = harness(controller, {
      chooseDirtyAction: vi.fn(async () => 'save' as const),
      chooseOpenDestination: vi.fn(async () => candidate),
    })

    await expect(coordinator.openDialog(sender(), request(current, true))).resolves.toEqual({
      outcome: 'stayed',
      session: current,
      reason: 'save-failed',
    })
    expect(dependencies.chooseOpenDestination).not.toHaveBeenCalled()
  })

  it('discards dirty edits without saving before switching', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const candidate = await packageRoot(parent, 'Candidate.podcut')
    const save = vi.spyOn(ProjectWorkspace.prototype, 'save')
    save.mockClear()
    const { coordinator } = harness(controller, {
      chooseDirtyAction: vi.fn(async () => 'discard' as const),
      chooseOpenDestination: vi.fn(async () => candidate),
    })

    await expect(coordinator.openDialog(sender(), request(current, true))).resolves.toMatchObject({
      outcome: 'switched',
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('uses a successful Save As as the rollback point when candidate validation later fails', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const destination = join(parent, 'Saved.podcut')
    const missingCandidate = join(parent, 'Missing.podcut')
    const { coordinator } = harness(controller, {
      chooseDirtyAction: vi.fn(async () => 'save' as const),
      chooseSaveDestination: vi.fn(async () => destination),
      chooseOpenDestination: vi.fn(async () => missingCandidate),
    })

    const result = await coordinator.openDialog(sender(), request(current, true))

    expect(result).toMatchObject({
      outcome: 'stayed',
      reason: 'candidate-invalid',
      session: { workspace: { kind: 'saved', displayName: 'Saved' }, revision: 2 },
    })
    expect(result.session.workspaceToken).not.toBe(current.workspaceToken)
    expect(controller.workspace.root).toBe(destination)
  })

  it.each([
    ['picker cancellation', 'cancelled'],
    ['job settlement failure', 'job-settlement-failed'],
    ['acknowledgement failure', 'switch-unacknowledged'],
  ] as const)('returns the advanced Save As rollback after %s', async (failure, reason) => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const destination = join(parent, 'Saved.podcut')
    const candidate = await packageRoot(parent, 'Candidate.podcut')
    const configured = harness(controller, {
      chooseDirtyAction: vi.fn(async () => 'save' as const),
      chooseSaveDestination: vi.fn(async () => destination),
      chooseOpenDestination: vi.fn(async () =>
        failure === 'picker cancellation' ? null : candidate,
      ),
    })
    if (failure === 'job settlement failure')
      configured.jobs.cancelAndSettleToken.mockRejectedValueOnce(new Error('job failed'))
    if (failure === 'acknowledgement failure')
      configured.barrier.wait.mockRejectedValueOnce(new Error('ack failed'))

    const result = await configured.coordinator.openDialog(sender(), request(current, true))

    expect(result).toMatchObject({
      outcome: 'stayed',
      reason,
      session: { revision: 2, workspace: { kind: 'saved', displayName: 'Saved' } },
    })
    expect(result.session.workspaceToken).not.toBe(current.workspaceToken)
    expect(controller.workspace.root).toBe(destination)
  })

  it.each([
    ['picker cancellation', null],
    ['candidate validation failure', 'missing'],
  ] as const)(
    'settles starting-token jobs before releasing a retired temporary workspace on %s',
    async (_failure, candidateSelection) => {
      const controller = new WorkspaceController()
      const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
      const current = await controller.initialize(parent)
      const oldRoot = controller.workspace.root
      const destination = join(parent, 'Saved.podcut')
      const jobs = new SessionJobRegistry()
      const settlement = deferred()
      const cancel = vi.fn(async () => {
        await expect(stat(oldRoot)).resolves.toBeTruthy()
        await writeFile(join(oldRoot, 'job-finished.txt'), 'settled')
        settlement.resolve()
      })
      jobs.register(
        {
          kind: 'transcription',
          jobId: 'old-job',
          senderId: 7,
          workspaceToken: current.workspaceToken,
          revision: current.revision,
        },
        () => ({ cancel, settled: settlement.promise }),
      )
      const coordinator = new ProjectTransitionCoordinator({
        controller,
        jobs,
        barrier: { wait: vi.fn(async () => {}) },
        chooseDirtyAction: async () => 'save',
        chooseSaveDestination: async () => destination,
        chooseOpenDestination: async () =>
          candidateSelection === null ? null : join(parent, 'Missing.podcut'),
      })

      const result = await coordinator.openDialog(sender(), request(current, true))

      expect(result).toMatchObject({
        outcome: 'stayed',
        reason: candidateSelection === null ? 'cancelled' : 'candidate-invalid',
        session: { revision: 2 },
      })
      expect(cancel).toHaveBeenCalledTimes(1)
      await expect(stat(oldRoot)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(controller.workspace.root).toBe(destination)
    },
  )

  it('retains a retired temporary root when starting-token settlement fails', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const oldRoot = controller.workspace.root
    const destination = join(parent, 'Saved.podcut')
    const jobs = new SessionJobRegistry()
    jobs.register(
      {
        kind: 'export',
        jobId: 'failed-job',
        senderId: 7,
        workspaceToken: current.workspaceToken,
        revision: current.revision,
      },
      () => ({
        cancel: vi.fn(async () => {
          throw new Error('cancel failed')
        }),
        settled: Promise.resolve(),
      }),
    )
    const coordinator = new ProjectTransitionCoordinator({
      controller,
      jobs,
      barrier: { wait: vi.fn(async () => {}) },
      chooseDirtyAction: async () => 'save',
      chooseSaveDestination: async () => destination,
      chooseOpenDestination: async () => null,
    })

    const result = await coordinator.openDialog(sender(), request(current, true))

    expect(result).toMatchObject({ outcome: 'stayed', reason: 'job-settlement-failed' })
    await expect(stat(oldRoot)).resolves.toBeTruthy()
    expect(controller.workspace.root).toBe(destination)
  })

  it('settles the starting token before releasing a retired temporary workspace when candidate selection rejects', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const oldRoot = controller.workspace.root
    const destination = join(parent, 'Saved.podcut')
    const selection = deferred<string | null>()
    const jobs = new SessionJobRegistry()
    const settled = deferred()
    const cancel = vi.fn(async () => {
      await expect(stat(oldRoot)).resolves.toBeTruthy()
      await writeFile(join(oldRoot, 'picker-rejection-job-finished.txt'), 'settled')
      settled.resolve()
    })
    jobs.register(
      {
        kind: 'transcription',
        jobId: 'picker-rejection-job',
        senderId: 7,
        workspaceToken: current.workspaceToken,
        revision: current.revision,
      },
      () => ({ cancel, settled: settled.promise }),
    )
    const coordinator = new ProjectTransitionCoordinator({
      controller,
      jobs,
      barrier: { wait: vi.fn(async () => {}) },
      chooseDirtyAction: async () => 'save',
      chooseSaveDestination: async () => destination,
      chooseOpenDestination: () => selection.promise,
    })

    const opening = coordinator.openDialog(sender(), request(current, true))
    await vi.waitFor(() => expect(controller.workspace.root).toBe(destination))
    selection.reject(new Error('/private/selection failure'))

    const result = await opening
    expect(result).toMatchObject({
      outcome: 'stayed',
      reason: 'candidate-invalid',
      session: { revision: 2, workspace: { kind: 'saved', displayName: 'Saved' } },
    })
    expect(result.session.workspaceToken).not.toBe(current.workspaceToken)
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(stat(oldRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.stringify(result)).not.toContain('/private/selection failure')
  })

  it('retains the retired temporary root and returns the advanced rollback when selection rejection settlement fails', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const oldRoot = controller.workspace.root
    const destination = join(parent, 'Saved.podcut')
    const jobs = new SessionJobRegistry()
    jobs.register(
      {
        kind: 'export',
        jobId: 'picker-rejection-failed-job',
        senderId: 7,
        workspaceToken: current.workspaceToken,
        revision: current.revision,
      },
      () => ({
        cancel: vi.fn(async () => Promise.reject(new Error('cancel failed'))),
        settled: Promise.resolve(),
      }),
    )
    const coordinator = new ProjectTransitionCoordinator({
      controller,
      jobs,
      barrier: { wait: vi.fn(async () => {}) },
      chooseDirtyAction: async () => 'save',
      chooseSaveDestination: async () => destination,
      chooseOpenDestination: async () => Promise.reject(new Error('selection failed')),
    })

    const result = await coordinator.openDialog(sender(), request(current, true))

    expect(result).toMatchObject({
      outcome: 'stayed',
      reason: 'job-settlement-failed',
      session: { revision: 2, workspace: { kind: 'saved', displayName: 'Saved' } },
    })
    expect(result.session.workspaceToken).not.toBe(current.workspaceToken)
    await expect(stat(oldRoot)).resolves.toBeTruthy()
    expect(controller.workspace.root).toBe(destination)
  })

  it('maps candidate selection rejection without Save As to a stayed result without settling jobs', async () => {
    const controller = new WorkspaceController()
    const current = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-transition-')))
    const configured = harness(controller, {
      chooseOpenDestination: vi.fn(async () => Promise.reject(new Error('selection failed'))),
    })

    await expect(configured.coordinator.openDialog(sender(), request(current))).resolves.toEqual({
      outcome: 'stayed',
      reason: 'candidate-invalid',
      session: current,
    })
    expect(configured.jobs.beginClosing).not.toHaveBeenCalled()
    expect(configured.jobs.cancelAndSettleToken).not.toHaveBeenCalled()
  })

  it.each([
    ['picker cancellation', null, 'cancelled'],
    ['candidate validation failure', 'missing', 'candidate-invalid'],
  ] as const)('keeps the current project after %s', async (_name, selected, reason) => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const { coordinator } = harness(controller, {
      chooseOpenDestination: vi.fn(async () =>
        selected === null ? null : join(parent, 'Missing.podcut'),
      ),
    })

    await expect(coordinator.openDialog(sender(), request(current))).resolves.toEqual({
      outcome: 'stayed',
      session: current,
      reason,
    })
  })

  it('does not reopen or commit a session when shutdown interrupts acknowledgement', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const candidate = await packageRoot(parent, 'Candidate.podcut')
    const { coordinator, jobs, barrier } = harness(controller, {
      chooseOpenDestination: vi.fn(async () => candidate),
    })
    barrier.wait.mockRejectedValueOnce(new ProjectSwitchShutdownError())

    await expect(coordinator.openDialog(sender(), request(current))).rejects.toBeInstanceOf(
      ProjectSwitchShutdownError,
    )
    expect(jobs.reopen).not.toHaveBeenCalled()
    expect(controller.workspace.root).not.toBe(candidate)
  })

  it.each(['nested', 'symlink'] as const)(
    'rejects a %s overlapping candidate before closing jobs or requesting playback teardown',
    async (kind) => {
      const controller = new WorkspaceController()
      const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
      const current = await controller.initialize(parent)
      const temporaryRoot = controller.workspace.root
      let candidate: string
      if (kind === 'nested') {
        candidate = await packageRoot(temporaryRoot, 'Nested.podcut')
      } else {
        candidate = join(parent, 'Alias.podcut')
        await symlink(temporaryRoot, candidate, 'dir')
      }
      const configured = harness(controller, {
        chooseOpenDestination: vi.fn(async () => candidate),
      })

      const result = await configured.coordinator.openDialog(sender(), request(current))

      expect(result).toEqual({
        outcome: 'stayed',
        reason: 'candidate-invalid',
        session: current,
      })
      expect(configured.jobs.beginClosing).not.toHaveBeenCalled()
      expect(configured.jobs.cancelAndSettleToken).not.toHaveBeenCalled()
      expect(configured.barrier.wait).not.toHaveBeenCalled()
      expect(controller.workspace.root).toBe(temporaryRoot)
    },
  )

  it.each([
    ['job settlement', 'job-settlement-failed'],
    ['playback acknowledgement', 'switch-unacknowledged'],
  ] as const)('reopens the rollback token after %s failure', async (failure, reason) => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const candidate = await packageRoot(parent, 'Candidate.podcut')
    const { coordinator, jobs, barrier } = harness(controller, {
      chooseOpenDestination: vi.fn(async () => candidate),
    })
    if (failure === 'job settlement')
      jobs.cancelAndSettleToken.mockRejectedValueOnce(new Error('job failed'))
    else barrier.wait.mockRejectedValueOnce(new Error('renderer lost'))

    await expect(coordinator.openDialog(sender(), request(current))).resolves.toEqual({
      outcome: 'stayed',
      session: current,
      reason,
    })
    expect(jobs.beginClosing).toHaveBeenCalledWith(current.workspaceToken)
    expect(jobs.reopen).toHaveBeenCalledWith(current.workspaceToken)
    expect(controller.workspace.root).not.toBe(candidate)
  })

  it('settles the starting and rollback tokens in order, switches, and deletes only temporary roots', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-transition-'))
    const current = await controller.initialize(parent)
    const oldTemporaryRoot = controller.workspace.root
    const savedRoot = join(parent, 'Saved.podcut')
    const candidate = await packageRoot(parent, 'Candidate.podcut')
    const events: string[] = []
    const jobs = {
      beginClosing: vi.fn((token) => events.push(`close:${token}`)),
      reopen: vi.fn(),
      cancelAndSettleToken: vi.fn(async (token) => {
        events.push(`settle:${token}`)
      }),
    }
    const barrier = {
      wait: vi.fn(async () => {
        events.push('ack')
      }),
    }
    const coordinator = new ProjectTransitionCoordinator({
      controller,
      jobs: jobs as unknown as SessionJobRegistry,
      barrier,
      chooseDirtyAction: async () => 'save',
      chooseSaveDestination: async () => savedRoot,
      chooseOpenDestination: async () => candidate,
    })

    const result = await coordinator.openDialog(sender(), request(current, true))

    expect(result).toMatchObject({ outcome: 'switched', session: { revision: 3 } })
    const rollbackToken = jobs.beginClosing.mock.calls[1][0]
    expect(rollbackToken).not.toBe(current.workspaceToken)
    expect(rollbackToken).not.toBe(result.session.workspaceToken)
    expect(events).toEqual([
      `close:${current.workspaceToken}`,
      `close:${rollbackToken}`,
      `settle:${current.workspaceToken}`,
      `settle:${rollbackToken}`,
      'ack',
    ])
    expect(controller.workspace.root).toBe(candidate)
    await expect(stat(oldTemporaryRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(savedRoot, 'project.json'), 'utf8')).toContain('"version": 1')
  })
})
