import type { WorkspaceToken } from '../../shared/session.types'

type SessionJobKind = 'import' | 'transcription' | 'export'

export interface SessionJobIdentity {
  kind: SessionJobKind
  jobId: string
  senderId: number
  workspaceToken: WorkspaceToken
}

export interface SessionJobExecution {
  cancel: () => void | Promise<void>
  settled: Promise<unknown>
}

interface RegisteredJob extends SessionJobIdentity, SessionJobExecution {
  cancellation: Promise<void> | null
  completion: Promise<void> | null
}

export class SessionJobRegistry {
  private readonly closingTokens = new Set<WorkspaceToken>()
  private readonly jobs = new Map<string, RegisteredJob>()

  register(identity: SessionJobIdentity, start: () => SessionJobExecution): () => void {
    if (this.closingTokens.has(identity.workspaceToken)) throw new Error('Session is closing')
    const key = jobKey(identity)
    if (this.jobs.has(key)) throw new Error('Job is already registered')
    const job: RegisteredJob = {
      ...identity,
      cancel: () => {},
      settled: Promise.resolve(),
      cancellation: null,
      completion: null,
    }
    this.jobs.set(key, job)
    try {
      const execution = start()
      job.cancel = execution.cancel
      job.settled = execution.settled
    } catch (error) {
      this.jobs.delete(key)
      throw error
    }
    let unregistered = false
    return () => {
      if (unregistered) return
      unregistered = true
      if (this.jobs.get(key) === job) this.jobs.delete(key)
    }
  }

  beginClosing(token: WorkspaceToken): void {
    this.closingTokens.add(token)
  }

  reopen(token: WorkspaceToken): void {
    this.closingTokens.delete(token)
  }

  async cancelAndSettleJob(identity: SessionJobIdentity): Promise<boolean> {
    const job = this.jobs.get(jobKey(identity))
    if (!job) return false
    await this.cancelAndSettle(job)
    return true
  }

  async cancelAndSettleToken(token: WorkspaceToken): Promise<void> {
    await this.cancelAndSettleAll(
      [...this.jobs.values()].filter((job) => job.workspaceToken === token),
    )
  }

  async cancelAndSettleSender(senderId: number): Promise<void> {
    await this.cancelAndSettleAll(
      [...this.jobs.values()].filter((job) => job.senderId === senderId),
    )
  }

  private cancelAndSettle(job: RegisteredJob): Promise<void> {
    if (job.completion) return job.completion
    if (!job.cancellation) job.cancellation = Promise.resolve().then(() => job.cancel())
    job.completion = Promise.allSettled([job.cancellation, job.settled]).then((results) => {
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
      if (errors.length) throw new AggregateError(errors, 'Session job cancellation failed')
    })
    return job.completion
  }

  private async cancelAndSettleAll(jobs: RegisteredJob[]): Promise<void> {
    const results = await Promise.allSettled(jobs.map((job) => this.cancelAndSettle(job)))
    const errors = results.flatMap((result) =>
      result.status === 'rejected'
        ? result.reason instanceof AggregateError
          ? [...result.reason.errors]
          : [result.reason]
        : [],
    )
    if (errors.length) throw new AggregateError(errors, 'Session job cancellation failed')
  }
}

function jobKey(identity: SessionJobIdentity): string {
  return JSON.stringify([identity.kind, identity.jobId, identity.senderId, identity.workspaceToken])
}
