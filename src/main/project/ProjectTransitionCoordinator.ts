import type {
  OpenProjectRequest,
  OpenProjectResult,
  OpenProjectStayedReason,
  RendererSession,
  WorkspaceToken,
} from '../../shared/session.types'
import type { SessionJobRegistry } from './SessionJobRegistry'
import {
  ProjectSwitchShutdownError,
  type ProjectSwitchSender,
  type SessionSwitchBarrier,
} from './SessionSwitchBarrier'
import type { WorkspaceController } from './WorkspaceController'

type DirtyAction = 'save' | 'discard' | 'cancel'

interface ProjectTransitionDependencies {
  controller: WorkspaceController
  jobs: SessionJobRegistry
  barrier: Pick<SessionSwitchBarrier, 'wait'>
  chooseDirtyAction(sender: ProjectSwitchSender): Promise<DirtyAction>
  chooseSaveDestination(sender: ProjectSwitchSender): Promise<string | null>
  chooseOpenDestination(sender: ProjectSwitchSender): Promise<string | null>
}

export class ProjectTransitionCoordinator {
  constructor(private readonly dependencies: ProjectTransitionDependencies) {}

  openDialog(sender: ProjectSwitchSender, request: OpenProjectRequest): Promise<OpenProjectResult> {
    return this.transition(sender, request, () => this.dependencies.chooseOpenDestination(sender))
  }

  openPath(
    sender: ProjectSwitchSender,
    request: OpenProjectRequest,
    path: string,
  ): Promise<OpenProjectResult> {
    return this.transition(sender, request, async () => path)
  }

  private transition(
    sender: ProjectSwitchSender,
    request: OpenProjectRequest,
    chooseCandidate: () => Promise<string | null>,
  ): Promise<OpenProjectResult> {
    return this.dependencies.controller.runTransition(request, async (transaction) => {
      const startingToken = transaction.precondition.workspaceToken
      let rollback = await transaction.describe()
      let retainedStartingWorkspace = false

      if (request.isDirty) {
        const action = await this.dependencies.chooseDirtyAction(sender)
        if (action === 'cancel') return stayed(rollback, 'cancelled')
        if (action === 'save') {
          try {
            if (rollback.workspace.kind === 'temporary') {
              const destination = await this.dependencies.chooseSaveDestination(sender)
              if (!destination) return stayed(rollback, 'cancelled')
              rollback = await transaction.saveAsForOpen(destination, request.draft)
              retainedStartingWorkspace = true
            } else {
              rollback = await transaction.save(request.draft)
            }
          } catch {
            return stayed(await transaction.describe(), 'save-failed')
          }
        }
      }

      const candidatePath = await chooseCandidate()
      if (!candidatePath)
        return retainedStartingWorkspace
          ? await this.settleStartingAndStay(transaction, startingToken, rollback, 'cancelled')
          : stayed(rollback, 'cancelled')

      let candidate
      try {
        candidate = await transaction.prepareOpen(candidatePath)
      } catch {
        return retainedStartingWorkspace
          ? await this.settleStartingAndStay(
              transaction,
              startingToken,
              rollback,
              'candidate-invalid',
            )
          : stayed(rollback, 'candidate-invalid')
      }

      const closingTokens = uniqueTokens(startingToken, rollback.workspaceToken)
      closingTokens.forEach((token) => this.dependencies.jobs.beginClosing(token))
      try {
        for (const token of closingTokens) await this.dependencies.jobs.cancelAndSettleToken(token)
      } catch {
        return this.reopenAndStay(rollback, 'job-settlement-failed')
      }
      if (retainedStartingWorkspace) await transaction.releaseRetiredWorkspaces().catch(() => {})
      try {
        await this.dependencies.barrier.wait(sender, rollback)
      } catch (error) {
        if (error instanceof ProjectSwitchShutdownError) throw error
        return this.reopenAndStay(rollback, 'switch-unacknowledged')
      }
      try {
        return { outcome: 'switched', session: await transaction.commitPreparedOpen(candidate) }
      } catch {
        return this.reopenAndStay(rollback, 'candidate-invalid')
      }
    })
  }

  private reopenAndStay(
    rollback: RendererSession,
    reason: OpenProjectStayedReason,
  ): OpenProjectResult {
    this.dependencies.jobs.reopen(rollback.workspaceToken)
    return stayed(rollback, reason)
  }

  private async settleStartingAndStay(
    transaction: { releaseRetiredWorkspaces(): Promise<void> },
    startingToken: WorkspaceToken,
    rollback: RendererSession,
    reason: OpenProjectStayedReason,
  ): Promise<OpenProjectResult> {
    this.dependencies.jobs.beginClosing(startingToken)
    try {
      await this.dependencies.jobs.cancelAndSettleToken(startingToken)
    } catch {
      return this.reopenAndStay(rollback, 'job-settlement-failed')
    }
    await transaction.releaseRetiredWorkspaces().catch(() => {})
    return stayed(rollback, reason)
  }
}

function stayed(session: RendererSession, reason: OpenProjectStayedReason): OpenProjectResult {
  return { outcome: 'stayed', session, reason }
}

function uniqueTokens(...tokens: WorkspaceToken[]): WorkspaceToken[] {
  return [...new Set(tokens)]
}
