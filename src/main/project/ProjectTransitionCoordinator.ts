import { MediaRecoveryCancelled } from './MediaRecoveryCoordinator'
import type { ProjectWorkspace } from './ProjectWorkspace'
import type {
  OpenProjectRequest,
  OpenProjectResult,
  OpenProjectStayedReason,
  RendererSession,
  WorkspaceToken,
} from '../../shared/session.types'
import type { SessionJobRegistry } from './SessionJobRegistry'
import {
  ProjectMutationCoordinator,
  SessionMutationSettlementError,
} from './ProjectMutationCoordinator'
import {
  ProjectSwitchShutdownError,
  type ProjectSwitchSender,
  type SessionSwitchBarrier,
} from './SessionSwitchBarrier'
import type { WorkspaceController } from './WorkspaceController'

type DirtyAction = 'save' | 'discard' | 'cancel'

interface ProjectTransitionDependencies {
  recoverMedia?(sender: ProjectSwitchSender, workspace: ProjectWorkspace): Promise<boolean>
  controller: WorkspaceController
  jobs: SessionJobRegistry
  barrier: Pick<SessionSwitchBarrier, 'wait'>
  chooseDirtyAction(sender: ProjectSwitchSender): Promise<DirtyAction>
  chooseSaveDestination(sender: ProjectSwitchSender): Promise<string | null>
  chooseOpenDestination(sender: ProjectSwitchSender): Promise<string | null>
}

export class ProjectTransitionCoordinator {
  private readonly mutations: ProjectMutationCoordinator

  constructor(private readonly dependencies: ProjectTransitionDependencies) {
    this.mutations = new ProjectMutationCoordinator(dependencies.controller, dependencies.jobs)
  }

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

  openStarter(
    sender: ProjectSwitchSender,
    request: OpenProjectRequest,
    kind: 'sample' | 'empty',
  ): Promise<OpenProjectResult> {
    return this.transition(sender, request, async () => null, kind)
  }

  private transition(
    sender: ProjectSwitchSender,
    request: OpenProjectRequest,
    chooseCandidate: () => Promise<string | null>,
    starterKind?: 'sample' | 'empty',
  ): Promise<OpenProjectResult> {
    return this.dependencies.controller.runTransition(request, async (transaction) => {
      const startingToken = transaction.precondition.workspaceToken
      let rollback = await transaction.describe()
      let retainedStartingWorkspace = false
      const settledClosedTokens = new Set<WorkspaceToken>()

      if (request.isDirty) {
        const action = await this.dependencies.chooseDirtyAction(sender)
        if (action === 'cancel') return stayed(rollback, 'cancelled')
        if (action === 'save') {
          let mutation
          try {
            mutation = await this.mutations.begin(transaction)
          } catch (error) {
            if (error instanceof SessionMutationSettlementError)
              return stayed(await transaction.describe(), 'job-settlement-failed')
            throw error
          }
          try {
            if (rollback.workspace.kind === 'temporary') {
              const destination = await this.dependencies.chooseSaveDestination(sender)
              if (!destination) {
                mutation.cancel()
                return stayed(rollback, 'cancelled')
              }
              rollback = await mutation.saveAsForOpen(destination, request.draft)
              retainedStartingWorkspace = true
              settledClosedTokens.add(startingToken)
            } else {
              rollback = await mutation.save(request.draft)
            }
          } catch {
            return stayed(await transaction.describe(), 'save-failed')
          }
        }
      }

      let candidatePath: string | null
      try {
        candidatePath = await chooseCandidate()
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
      if (!candidatePath && !starterKind)
        return retainedStartingWorkspace
          ? await this.settleStartingAndStay(transaction, startingToken, rollback, 'cancelled')
          : stayed(rollback, 'cancelled')

      let candidate
      try {
        candidate = starterKind
          ? await transaction.prepareStarter(starterKind)
          : await transaction.prepareOpen(candidatePath!, async (workspace) => {
              if (
                this.dependencies.recoverMedia &&
                !(await this.dependencies.recoverMedia(sender, workspace))
              )
                throw new MediaRecoveryCancelled()
            })
      } catch (error) {
        const reason = error instanceof MediaRecoveryCancelled ? 'cancelled' : 'candidate-invalid'
        return retainedStartingWorkspace
          ? await this.settleStartingAndStay(transaction, startingToken, rollback, reason)
          : stayed(rollback, reason)
      }

      const closingTokens = uniqueTokens(startingToken, rollback.workspaceToken).filter(
        (token) => !settledClosedTokens.has(token),
      )
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
