import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type { EventEmitter } from 'events'
import { rename, rm, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type {
  ExportCancellationResult,
  ExportJobId,
  RenderProgressEvent,
  SessionJobResult,
} from '../../../shared/ipc.types'
import type { AudioSourceId, ProjectFile } from '../../../shared/project.types'
import type { SessionPrecondition } from '../../../shared/session.types'
import {
  discardCleanupWarnings,
  recordCleanupWarning,
  type CleanupWarningSink,
} from '../../project/CleanupWarningSink'
import { getFfmpegPath } from '../binaries'
import { buildRenderArgs } from '../renderer'

export interface ExportChild extends EventEmitter {
  stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals | number): boolean
}

interface ExportIdentity extends SessionPrecondition {
  jobId: ExportJobId
  senderId: number
}

export interface ExportExecution {
  settled: Promise<SessionJobResult<boolean, ExportJobId>>
  requestCancel(): Promise<ExportCancellationResult>
}

interface ExportStartRequest {
  identity: ExportIdentity
  project: ProjectFile
  selectDestination: () => Promise<string | null>
  resolveOriginal: (audioSourceId: AudioSourceId) => Promise<string>
  revalidate: () => void
  onProgress: (progress: RenderProgressEvent) => void
}

interface ExportCoordinatorDependencies {
  spawn: (command: string, arguments_: string[]) => ExportChild
  createId: () => string
  ffmpegPath: () => string
  rename: (source: string, destination: string) => Promise<void>
  remove: (path: string) => Promise<void>
  stat: typeof stat
  cleanupWarningSink: CleanupWarningSink
}

type ExportState = 'selecting' | 'rendering' | 'publishing' | 'committed' | 'cancelled' | 'failed'

interface ActiveExport {
  identity: ExportIdentity
  controller: AbortController
  state: ExportState
  settled: Promise<SessionJobResult<boolean, ExportJobId>>
}

export class ExportCoordinator {
  private readonly activeBySender = new Map<number, ActiveExport>()

  constructor(dependencies: Partial<ExportCoordinatorDependencies> = {}) {
    this.dependencies = {
      spawn: (command, arguments_) =>
        spawn(command, arguments_, { stdio: ['ignore', 'ignore', 'pipe'] }) as ExportChild,
      createId: randomUUID,
      ffmpegPath: getFfmpegPath,
      rename,
      remove: (path) => rm(path, { force: true }),
      stat,
      cleanupWarningSink: discardCleanupWarnings,
      ...dependencies,
    }
  }

  private readonly dependencies: ExportCoordinatorDependencies

  start(request: ExportStartRequest): ExportExecution {
    const { identity } = request
    if (this.activeBySender.has(identity.senderId))
      throw new Error('Another export is already active for this window')
    const controller = new AbortController()
    const active: ActiveExport = {
      identity,
      controller,
      state: 'selecting' as ExportState,
      settled: undefined as unknown as Promise<SessionJobResult<boolean, ExportJobId>>,
    }
    this.activeBySender.set(identity.senderId, active)
    active.settled = this.run(active, request)
    return {
      settled: active.settled,
      requestCancel: async () => {
        if (active.state === 'committed') return 'commit-won'
        active.controller.abort()
        try {
          await active.settled
        } catch {
          // The registry observes non-cancellation failures through settled.
        }
        return isCommitted(active) ? 'commit-won' : 'cancelled'
      },
    }
  }

  private async run(
    active: ActiveExport,
    request: ExportStartRequest,
  ): Promise<SessionJobResult<boolean, ExportJobId>> {
    const { identity, controller } = active
    let temporaryOutput: string | null = null
    let backupOutput: string | null = null
    let temporaryOwned = false
    let backupOwned = false
    let failure: unknown = null
    let result: SessionJobResult<boolean, ExportJobId> | null = null
    try {
      try {
        const destination = await request.selectDestination()
        if (!destination) {
          result = { ...envelope(identity), value: false }
          return result
        }
        throwIfAborted(controller.signal)
        const artifactId = this.dependencies.createId()
        temporaryOutput = siblingArtifact(destination, 'export', artifactId)
        backupOutput = siblingArtifact(destination, 'backup', artifactId)
        temporaryOwned = true
        const sourcePaths = new Map<string, string>()
        for (const source of request.project.audioSources) {
          sourcePaths.set(source.id, await request.resolveOriginal(source.id))
          throwIfAborted(controller.signal)
        }
        active.state = 'rendering'
        const child = this.dependencies.spawn(
          this.dependencies.ffmpegPath(),
          buildRenderArgs(request.project, sourcePaths, temporaryOutput),
        )
        await waitForSuccessfulClose(
          child,
          controller.signal,
          request.project,
          identity,
          request.onProgress,
        )
        throwIfAborted(controller.signal)
        const destinationExists = await pathExists(this.dependencies.stat, destination)
        throwIfAborted(controller.signal)
        request.revalidate()
        active.state = 'publishing'
        if (destinationExists) {
          await this.dependencies.rename(destination, backupOutput)
          backupOwned = true
          if (controller.signal.aborted) {
            try {
              await this.dependencies.rename(backupOutput, destination)
              backupOwned = false
            } catch (rollbackError) {
              throw new AggregateError(
                [new DOMException('Export cancelled', 'AbortError'), rollbackError],
                'Export publication rollback failed',
                { cause: rollbackError },
              )
            }
            throw new DOMException('Export cancelled', 'AbortError')
          }
        }
        try {
          await this.dependencies.rename(temporaryOutput, destination)
          temporaryOwned = false
        } catch (publicationError) {
          if (backupOwned) {
            try {
              await this.dependencies.rename(backupOutput, destination)
              backupOwned = false
            } catch (rollbackError) {
              throw new AggregateError(
                [publicationError, rollbackError],
                'Export publication rollback failed',
                { cause: rollbackError },
              )
            }
          }
          throw publicationError
        }
        active.state = 'committed'
        if (backupOwned) {
          try {
            await this.dependencies.remove(backupOutput)
          } catch (cause) {
            await recordCleanupWarning(this.dependencies.cleanupWarningSink, {
              path: backupOutput,
              operation: 'export-publication',
              kind: 'destination-backup',
              cause,
            })
          }
          backupOwned = false
        }
        result = { ...envelope(identity), value: true }
      } catch (error) {
        failure = error
        if (active.state !== 'committed')
          active.state = controller.signal.aborted ? 'cancelled' : 'failed'
      }
      const cleanupErrors: unknown[] = []
      if (temporaryOwned && temporaryOutput) {
        try {
          await this.dependencies.remove(temporaryOutput)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      if (active.state === 'committed' && backupOwned && backupOutput) {
        try {
          await this.dependencies.remove(backupOutput)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      if (cleanupErrors.length) {
        const causes = failure ? [failure, ...cleanupErrors] : cleanupErrors
        throw new AggregateError(causes, 'Export cleanup failed')
      }
      if (failure) throw failure
      if (!result) throw new Error('Export completed without a result')
      return result
    } finally {
      if (this.activeBySender.get(identity.senderId) === active)
        this.activeBySender.delete(identity.senderId)
    }
  }
}

function siblingArtifact(destination: string, kind: 'export' | 'backup', id: string): string {
  const extension = extname(destination)
  const stem = basename(destination, extension)
  return join(dirname(destination), `.${stem}.podcut-${kind}-${id}${extension}`)
}

async function waitForSuccessfulClose(
  child: ExportChild,
  signal: AbortSignal,
  project: ProjectFile,
  identity: ExportIdentity,
  onProgress: (progress: RenderProgressEvent) => void,
): Promise<void> {
  let killed = false
  let closed = false
  let firstFailure: unknown = null
  let diagnosticTail: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let progressFragment = ''
  const killOnce = () => {
    if (killed || closed) return
    killed = true
    child.kill('SIGKILL')
  }
  const recordFailure = (error: unknown) => {
    if (!firstFailure) firstFailure = error
    killOnce()
  }
  const abort = () => recordFailure(new DOMException('Export cancelled', 'AbortError'))
  const reportProgress = (text: string) => {
    const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
    const match = matches.at(-1)
    if (!match) return
    const currentSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    const totalSeconds = project.tracks
      .flatMap((track) => track.clips)
      .reduce(
        (maximum, clip) => Math.max(maximum, clip.outputStart + clip.sourceEnd - clip.sourceStart),
        0,
      )
    try {
      onProgress({
        ...envelope(identity),
        percent: totalSeconds ? Math.min(1, currentSeconds / totalSeconds) : 0,
        currentSeconds,
        totalSeconds,
      })
    } catch {
      // Progress is advisory and cannot affect export settlement.
    }
  }
  child.once('error', recordFailure)
  child.stderr?.once('error', recordFailure)
  child.stderr?.on('data', (chunk: Buffer | string) => {
    diagnosticTail = appendDiagnosticTail(diagnosticTail, chunk)
    progressFragment = (progressFragment + chunk.toString()).slice(-256)
    const records = progressFragment.split(/[\r\n]/)
    progressFragment = records.pop()!
    for (const record of records) reportProgress(record)
  })
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    const code = await new Promise<number | null>((resolve) => {
      child.once('close', (exitCode) => {
        closed = true
        resolve(exitCode)
      })
    })
    reportProgress(progressFragment)
    if (firstFailure) throw firstFailure
    if (code !== 0) {
      const diagnostic = diagnosticTail.toString().trim()
      throw new Error(
        `FFmpeg export failed with exit code ${String(code)}${diagnostic ? `: ${diagnostic}` : ''}`,
      )
    }
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

function appendDiagnosticTail(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer | string,
): Buffer<ArrayBufferLike> {
  const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  if (next.byteLength >= 4096) return next.subarray(next.byteLength - 4096)
  const combined = Buffer.concat([current, next])
  return combined.byteLength <= 4096 ? combined : combined.subarray(combined.byteLength - 4096)
}

function isCommitted(active: ActiveExport): boolean {
  return active.state === 'committed'
}

async function pathExists(statPath: typeof stat, path: string): Promise<boolean> {
  try {
    await statPath(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function envelope(identity: ExportIdentity) {
  return {
    jobId: identity.jobId,
    workspaceToken: identity.workspaceToken,
    revision: identity.revision,
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
}
