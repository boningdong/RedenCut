import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DiagnosticLog } from './DiagnosticLog'
import { DiagnosticReport } from './DiagnosticReport'
import { DiagnosticReportSchema } from '../../shared/diagnostics.types'

it('exports only selected operations and saves the exact preview after rotation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diagnostic-report-'))
  try {
    const log = await DiagnosticLog.create(directory, { maxBytes: 350, maxFiles: 2 })
    const id = crypto.randomUUID()
    const other = crypto.randomUUID()
    await log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'info',
      event: 'speech/stage-started',
      operationId: 'selected',
      facts: { stage: 'aligning' },
    })
    await log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'error',
      event: 'operation/failed',
      operationId: 'selected',
      diagnosticId: id,
      facts: { code: 'speech/alignment-segment-mismatch', stage: 'aligning' },
    })
    await log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'error',
      event: 'operation/failed',
      operationId: 'unrelated',
      diagnosticId: other,
      facts: { code: 'speech/alignment-inference-failed', stage: 'aligning' },
    })
    const reports = new DiagnosticReport(log, {
      appVersion: 'test',
      platform: 'darwin',
      architecture: 'arm64',
    })
    const preview = await reports.previewReport({ diagnosticIds: [id] })
    expect(reports.suggestedFilename(preview.previewId)).toBe(
      `redencut-diagnostics-${id.slice(0, 8)}.json`,
    )
    expect(preview.content).toContain(id)
    expect(preview.content).not.toContain(other)
    expect(preview.content).not.toContain('/private/')
    expect(DiagnosticReportSchema.safeParse(JSON.parse(preview.content)).success).toBe(true)
    expect(
      DiagnosticReportSchema.safeParse({
        ...JSON.parse(preview.content),
        privatePath: '/private/audio',
      }).success,
    ).toBe(false)
    for (let i = 0; i < 5; i++)
      await log.write({
        schemaVersion: 1,
        time: new Date().toISOString(),
        level: 'info',
        event: 'speech/stage-started',
        operationId: `new-${i}`,
        facts: { stage: 'aligning' },
      })
    const destination = join(directory, 'report.json')
    await reports.saveReport(preview.previewId, destination)
    expect(await readFile(destination, 'utf8')).toBe(preview.content)
    const missing = await reports.previewReport({ diagnosticIds: [id] })
    expect(missing.partial).toBe(true)
    await log.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
