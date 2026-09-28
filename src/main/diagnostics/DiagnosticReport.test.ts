import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { DiagnosticLog } from './DiagnosticLog'
import { DiagnosticReport } from './DiagnosticReport'

it('reports selected history missing while retaining unrelated event context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diagnostic-report-'))
  const log = await DiagnosticLog.create(join(root, 'logs'))
  const reports = new DiagnosticReport(
    log,
    { appVersion: 'test', platform: 'darwin', architecture: 'arm64' },
    { root: join(root, 'snapshots') },
  )
  try {
    await log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'info',
      event: 'speech/stage-started',
      operationId: 'another-job',
      facts: { stage: 'aligning' },
    })
    const p = await reports.previewReport(
      { kind: 'failure', diagnosticIds: [crypto.randomUUID()] },
      1,
    )
    expect(p.manifest.warnings).toContain('history-missing')
    expect(p.manifest.files.length).toBe(1)
    expect(reports.suggestedFilename(p.previewId, 1)).toMatch(/\.zip$/)
  } finally {
    await reports.dispose()
    await log.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
