import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir, release } from 'node:os'
import { join } from 'node:path'
import {
  DiagnosticCollectionRequestSchema,
  DiagnosticBundleManifestSchema,
  DiagnosticWarnings,
  type DiagnosticBundleManifest,
  type DiagnosticCollectionRequest,
  type DiagnosticReportPreview,
} from '../../shared/DiagnosticBundleTypes'
import { emptyLogLosses } from '../../shared/AppLogMessageTypes'
import type { DiagnosticLog } from './DiagnosticLog'
import type { RotatingLogWriter } from '../logging/RotatingLogWriter'
import { normalizeSnapshotFile } from './DiagnosticSnapshotFiles'
import { appLogger } from '../logging/AppLogger'
import { saveDiagnosticBundle } from './DiagnosticBundle'

interface Environment {
  appVersion: string
  platform: string
  architecture: string
  osVersion?: string
}
interface Snapshot {
  preview: DiagnosticReportPreview
  root: string
  owner: number
  expiresAt: number
  savedPath?: string
  leases: number
  released: boolean
  timer: ReturnType<typeof setTimeout>
}
interface Options {
  messages?: RotatingLogWriter
  root?: string
}
export class ReportSaveError extends Error {
  constructor() {
    super('The diagnostic report could not be saved.')
  }
}
export class DiagnosticReport {
  private snapshots = new Map<string, Snapshot>()
  private preparing = 0
  private destroyedOwners = new Set<number>()
  private disposed = false
  private readonly root: string
  private readonly startup: Promise<void>
  constructor(
    private readonly log: Pick<DiagnosticLog, 'snapshot'>,
    private readonly environment: Environment,
    private readonly options: Options = {},
  ) {
    this.root = options.root ?? join(tmpdir(), `redencut-diagnostic-snapshots-${randomUUID()}`)
    this.startup = rm(this.root, { recursive: true, force: true })
      .then(() => mkdir(this.root, { recursive: true, mode: 0o700 }))
      .then(() => {})
    void this.startup.catch(() => {})
  }
  async previewReport(
    input: DiagnosticCollectionRequest,
    owner: number,
  ): Promise<DiagnosticReportPreview> {
    const request = DiagnosticCollectionRequestSchema.parse(input)
    if (this.disposed || this.destroyedOwners.has(owner))
      throw new Error('Diagnostic collection unavailable')
    if (this.snapshots.size + this.preparing >= 2) throw new Error('Too many diagnostic previews')
    this.preparing++
    let root: string | undefined
    try {
      await this.startup
      root = await mkdtemp(join(this.root, 'preview-'))
      const ids = request.kind === 'failure' ? [...new Set(request.diagnosticIds)] : []
      const warnings = new Set<DiagnosticBundleManifest['warnings'][number]>()
      const [events, messages] = await Promise.all([
        this.log.snapshot(join(root, 'events')).catch(() => {
          warnings.add(DiagnosticWarnings.LogsUnavailable)
          return [] as string[]
        }),
        this.options.messages?.snapshot(join(root, 'runtime')).catch(() => {
          warnings.add(DiagnosticWarnings.LogsUnavailable)
          return undefined
        }),
      ])
      if (!this.options.messages) warnings.add(DiagnosticWarnings.LogsUnavailable)
      const losses = messages?.losses ?? { ...emptyLogLosses(), countersComplete: false }
      const manifest: DiagnosticBundleManifest = {
        bundleVersion: 1,
        generatedAt: new Date().toISOString(),
        environment: { ...this.environment, osVersion: this.environment.osVersion ?? release() },
        diagnosticIds: ids,
        files: [],
        coverage: { scope: 'retained-history' },
        losses,
        warnings: [],
      }
      const failures = new Set<string>()
      const historicalLosses = new Map<string, typeof losses>()
      for (const [kind, names] of [
        ['events', events],
        ['runtime', messages?.files ?? []],
      ] as const) {
        for (const name of names) {
          const summary = await normalizeSnapshotFile(join(root, kind), name, kind)
          for (const id of summary.failures) failures.add(id)
          if (summary.invalid) warnings.add(DiagnosticWarnings.InvalidRecords)
          if (summary.from && (!manifest.coverage.from || summary.from < manifest.coverage.from))
            manifest.coverage.from = summary.from
          if (summary.to && (!manifest.coverage.to || summary.to > manifest.coverage.to))
            manifest.coverage.to = summary.to
          for (const [session, counters] of summary.losses) {
            if (messages?.sessionIds.includes(session)) continue
            const previous = historicalLosses.get(session)
            if (previous) {
              for (const level of ['info', 'warn', 'error'] as const)
                previous.droppedRecords[level] = Math.max(
                  previous.droppedRecords[level],
                  counters.droppedRecords[level],
                )
              previous.truncatedRecords = Math.max(
                previous.truncatedRecords,
                counters.truncatedRecords,
              )
              previous.writeFailures = Math.max(previous.writeFailures, counters.writeFailures)
            } else historicalLosses.set(session, structuredClone(counters))
          }
          if (summary.bytes)
            manifest.files.push({ path: `${kind}/${name}`, kind, bytes: summary.bytes })
        }
      }
      for (const counters of historicalLosses.values()) {
        for (const level of ['info', 'warn', 'error'] as const)
          losses.droppedRecords[level] += counters.droppedRecords[level]
        losses.truncatedRecords += counters.truncatedRecords
        losses.writeFailures += counters.writeFailures
        losses.countersComplete = false // Older sessions may have rotated away their final loss summary.
      }
      if (ids.some((id) => !failures.has(id))) warnings.add(DiagnosticWarnings.HistoryMissing)
      if (
        losses.truncatedRecords ||
        losses.writeFailures ||
        Object.values(losses.droppedRecords).some(Boolean)
      )
        warnings.add(DiagnosticWarnings.Losses)
      if (!losses.countersComplete) warnings.add(DiagnosticWarnings.IncompleteCounters)
      manifest.warnings = [...warnings]
      DiagnosticBundleManifestSchema.parse(manifest)
      const content = JSON.stringify(manifest, null, 2) + '\n'
      await writeFile(join(root, 'manifest.json'), content, { mode: 0o600 })
      const preview: DiagnosticReportPreview = {
        previewId: randomUUID(),
        manifest,
        totalBytes:
          Buffer.byteLength(content) + manifest.files.reduce((total, f) => total + f.bytes, 0),
      }
      if (this.disposed || this.destroyedOwners.has(owner))
        throw new Error('Diagnostic owner closed')
      const timer = setTimeout(
        () => void this.releaseReport(preview.previewId, owner).catch(appLogger.reportError),
        10 * 60_000,
      )
      timer.unref()
      this.snapshots.set(preview.previewId, {
        preview,
        root,
        owner,
        expiresAt: Date.now() + 10 * 60_000,
        leases: 0,
        released: false,
        timer,
      })
      return preview
    } catch (error) {
      if (root) await rm(root, { recursive: true, force: true })
      throw error
    } finally {
      this.preparing--
    }
  }
  async inspectReport(id: string, owner: number, open: (path: string) => Promise<void>) {
    const snapshot = this.requireSnapshot(id, owner)
    snapshot.leases++
    try {
      await open(snapshot.root)
    } finally {
      snapshot.leases--
      await this.cleanup(snapshot, id)
    }
  }
  async saveReport(id: string, destination: string, owner: number): Promise<void> {
    const snapshot = this.requireSnapshot(id, owner)
    snapshot.leases++
    try {
      await saveDiagnosticBundle(snapshot.root, snapshot.preview.manifest, destination)
      snapshot.savedPath = destination
    } finally {
      snapshot.leases--
      await this.cleanup(snapshot, id)
    }
  }
  savedPath(id: string, owner: number) {
    return this.requireSnapshot(id, owner).savedPath ?? null
  }
  snapshotPath(id: string, owner: number) {
    return this.requireSnapshot(id, owner).root
  }
  suggestedFilename(id: string, owner: number) {
    const s = this.requireSnapshot(id, owner)
    return `redencut-diagnostics-${s.preview.manifest.generatedAt.replace(/[:.]/g, '-')}.zip`
  }
  async releaseReport(id: string, owner: number) {
    const s = this.snapshots.get(id)
    if (!s || s.owner !== owner) return
    s.released = true
    clearTimeout(s.timer)
    await this.cleanup(s, id)
  }
  async releaseOwner(owner: number) {
    this.destroyedOwners.add(owner)
    await Promise.all(
      [...this.snapshots]
        .filter(([, s]) => s.owner === owner)
        .map(([id]) => this.releaseReport(id, owner)),
    )
  }
  async dispose() {
    this.disposed = true
    await Promise.all([...this.snapshots].map(([id, s]) => this.releaseReport(id, s.owner)))
  }
  private async cleanup(s: Snapshot, id: string) {
    if (s.released && !s.leases) {
      this.snapshots.delete(id)
      await rm(s.root, { recursive: true, force: true })
    }
  }
  private requireSnapshot(id: string, owner: number) {
    const s = this.snapshots.get(id)
    if (!s || s.owner !== owner || s.released || s.expiresAt < Date.now())
      throw new Error('Diagnostic preview expired or invalid')
    return s
  }
}
