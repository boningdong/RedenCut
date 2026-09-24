import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import {
  DiagnosticReportSchema,
  type AppLogEvent,
  type DiagnosticReportPreview,
} from '../../shared/diagnostics.types'
import type { DiagnosticLog } from './DiagnosticLog'

interface Environment {
  appVersion: string
  platform: string
  architecture: string
}

interface Snapshot {
  preview: DiagnosticReportPreview
  expiresAt: number
  savedPath?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EVENTS = 1000
const MAX_BYTES = 2 * 1024 * 1024

export class ReportSaveError extends Error {
  constructor() {
    super('The diagnostic report could not be saved.')
  }
}

export class DiagnosticReport {
  private readonly snapshots = new Map<string, Snapshot>()

  constructor(
    private readonly log: Pick<DiagnosticLog, 'flush' | 'readRecent'>,
    private readonly environment: Environment,
  ) {}

  async recentFailure(): Promise<string | null> {
    const events = await this.log.readRecent()
    return (
      [...events].reverse().find((event) => event.event === 'operation/failed')?.diagnosticId ??
      null
    )
  }

  async previewReport(input: { diagnosticIds: string[] }): Promise<DiagnosticReportPreview> {
    if (
      !Array.isArray(input.diagnosticIds) ||
      input.diagnosticIds.length < 1 ||
      input.diagnosticIds.length > 20 ||
      input.diagnosticIds.some((id) => typeof id !== 'string' || !UUID.test(id))
    )
      throw new Error('Invalid diagnostic IDs')
    await this.log.flush()
    const all = await this.log.readRecent()
    const ids = [...new Set(input.diagnosticIds)]
    const failures = all.filter(
      (event) =>
        event.event === 'operation/failed' &&
        event.diagnosticId &&
        ids.includes(event.diagnosticId),
    )
    const operations = new Set(failures.map((event) => event.operationId))
    const selected = all.filter((event) => operations.has(event.operationId))
    let partial = failures.length < ids.length || selected.length > MAX_EVENTS
    let events: AppLogEvent[] = selected.slice(-MAX_EVENTS)
    const generatedAt = new Date().toISOString()
    const serialize = () =>
      JSON.stringify(
        DiagnosticReportSchema.parse({
          reportVersion: 1,
          generatedAt,
          diagnosticIds: ids,
          partial,
          environment: this.environment,
          events,
        }),
        null,
        2,
      ) + '\n'
    let content = serialize()
    while (Buffer.byteLength(content) > MAX_BYTES && events.length) {
      events = events.slice(Math.min(25, events.length))
      partial = true
      content = serialize()
    }
    const preview: DiagnosticReportPreview = {
      previewId: randomUUID(),
      content,
      eventCount: events.length,
      partial,
      diagnosticIds: ids,
    }
    const now = Date.now()
    for (const [key, value] of this.snapshots) if (value.expiresAt < now) this.snapshots.delete(key)
    this.snapshots.set(preview.previewId, { preview, expiresAt: now + 10 * 60_000 })
    return preview
  }

  async saveReport(previewId: string, destination: string): Promise<void> {
    const snapshot = this.requireSnapshot(previewId)
    await writeFile(destination, snapshot.preview.content, 'utf8')
    snapshot.savedPath = destination
  }

  savedPath(previewId: string): string | null {
    return this.requireSnapshot(previewId).savedPath ?? null
  }

  suggestedFilename(previewId: string): string {
    const id = this.requireSnapshot(previewId).preview.diagnosticIds[0]
    return `redencut-diagnostics-${id.slice(0, 8)}.json`
  }

  private requireSnapshot(previewId: string): Snapshot {
    const snapshot = this.snapshots.get(previewId)
    if (!snapshot || snapshot.expiresAt < Date.now()) throw new Error('Diagnostic preview expired')
    return snapshot
  }
}
