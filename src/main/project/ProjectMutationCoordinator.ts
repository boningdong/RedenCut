import type {
  ProjectDraft,
  ProjectMutationRequest,
  RendererSession,
} from '../../shared/session.types'
import type { SessionJobRegistry } from './SessionJobRegistry'
import type { WorkspaceController, WorkspaceTransaction } from './WorkspaceController'

export class SessionMutationSettlementError extends Error {
  constructor(cause: unknown) {
    super('Session jobs could not be settled before project mutation', { cause })
    this.name = 'SessionMutationSettlementError'
  }
}

export interface ProjectMutationLease {
  cancel(): void
  save(draft: ProjectDraft): Promise<RendererSession>
  saveAs(destination: string, draft: ProjectDraft): Promise<RendererSession>
  saveAsForOpen(destination: string, draft: ProjectDraft): Promise<RendererSession>
}

export class ProjectMutationCoordinator {
  constructor(
    private readonly controller: WorkspaceController,
    private readonly jobs: SessionJobRegistry,
  ) {}

  save(request: ProjectMutationRequest): Promise<RendererSession> {
    return this.controller.runTransition(request, async (transaction) => {
      const token = transaction.precondition.workspaceToken
      this.jobs.beginClosing(token)
      try {
        try {
          await this.jobs.cancelAndSettleKinds(token, ['transcription', 'export'])
        } catch (error) {
          throw new SessionMutationSettlementError(error)
        }
        return await transaction.save(request.draft)
      } finally {
        this.jobs.reopen(token)
      }
    })
  }

  saveAs(destination: string, request: ProjectMutationRequest): Promise<RendererSession> {
    return this.controller.runTransition(request, async (transaction) =>
      (await this.begin(transaction)).saveAs(destination, request.draft),
    )
  }

  async begin(transaction: WorkspaceTransaction): Promise<ProjectMutationLease> {
    const startingToken = transaction.precondition.workspaceToken
    this.jobs.beginClosing(startingToken)
    try {
      await this.jobs.cancelAndSettleToken(startingToken)
    } catch (error) {
      this.jobs.reopen(startingToken)
      throw new SessionMutationSettlementError(error)
    }
    let completed = false
    const finish = async (mutation: () => Promise<RendererSession>): Promise<RendererSession> => {
      if (completed) throw new Error('Project mutation lease is already completed')
      completed = true
      try {
        const result = await mutation()
        if (result.workspaceToken === startingToken) this.jobs.reopen(startingToken)
        return result
      } catch (error) {
        const authoritative = await transaction.describe().catch(() => null)
        this.jobs.reopen(authoritative?.workspaceToken ?? startingToken)
        throw error
      }
    }
    return {
      cancel: () => {
        if (completed) return
        completed = true
        this.jobs.reopen(startingToken)
      },
      save: (draft) => finish(() => transaction.save(draft)),
      saveAs: (destination, draft) => finish(() => transaction.saveAs(destination, draft)),
      saveAsForOpen: (destination, draft) =>
        finish(() => transaction.saveAsForOpen(destination, draft)),
    }
  }
}
