import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it, vi } from 'vitest'
import { ProjectMutationCoordinator } from './ProjectMutationCoordinator'
import { SessionJobRegistry } from './SessionJobRegistry'
import { WorkspaceController } from './WorkspaceController'

it('saves the latest draft without cancelling admitted source jobs and keeps strict revision checks', async () => {
  const controller = new WorkspaceController()
  const session = await controller.initialize(
    await mkdtemp(join(tmpdir(), 'redencut-save-background-')),
  )
  const jobs = new SessionJobRegistry()
  let settle!: () => void
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const cancel = vi.fn(() => settle())
  const unregister = jobs.register(
    {
      kind: 'speech-analysis',
      jobId: 'active',
      senderId: 1,
      workspaceToken: session.workspaceToken,
      revision: session.revision,
    },
    () => ({ cancel, settled }),
  )
  const mutations = new ProjectMutationCoordinator(controller, jobs)
  const saved = await mutations.save({
    ...session,
    draft: { ...session.draft, export: { ...session.draft.export, targetLUFS: -10 } },
  })
  settle()
  unregister()
  expect(cancel).not.toHaveBeenCalled()
  expect(saved.draft.export.targetLUFS).toBe(-10)
  await expect(mutations.save({ ...session, draft: session.draft })).rejects.toThrow(
    'Stale workspace revision',
  )
})

it('settles a legacy job while retaining simultaneous import and speech jobs', async () => {
  const controller = new WorkspaceController()
  const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'redencut-save-mixed-')))
  const jobs = new SessionJobRegistry()
  const cancelSource = vi.fn()
  for (const kind of ['import', 'speech-analysis'] as const) {
    jobs.register(
      {
        kind,
        jobId: kind,
        senderId: 1,
        workspaceToken: session.workspaceToken,
        revision: session.revision,
      },
      () => ({ cancel: cancelSource, settled: new Promise<void>(() => {}) }),
    )
  }
  let resolveLegacy!: () => void
  const legacySettled = new Promise<void>((resolve) => {
    resolveLegacy = resolve
  })
  const cancelLegacy = vi.fn()
  jobs.register(
    {
      kind: 'export',
      jobId: 'export',
      senderId: 1,
      workspaceToken: session.workspaceToken,
      revision: session.revision,
    },
    () => ({ cancel: cancelLegacy, settled: legacySettled }),
  )
  const saving = new ProjectMutationCoordinator(controller, jobs).save({
    ...session,
    draft: session.draft,
  })
  await vi.waitFor(() => expect(cancelLegacy).toHaveBeenCalledOnce())
  expect(cancelSource).not.toHaveBeenCalled()
  resolveLegacy()
  expect((await saving).revision).toBe(session.revision + 1)
  expect(cancelSource).not.toHaveBeenCalled()
})
