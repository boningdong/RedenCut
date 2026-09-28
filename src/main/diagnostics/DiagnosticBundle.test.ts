import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unzip } from './DiagnosticZipTestSupport'
import { afterEach, expect, it } from 'vitest'
import { DiagnosticLog } from './DiagnosticLog'
import { DiagnosticReport } from './DiagnosticReport'
import { RotatingLogWriter } from '../logging/RotatingLogWriter'
import { AppLogger } from '../logging/AppLogger'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'diag-bundle-'))
  roots.push(root)
  const log = await DiagnosticLog.create(join(root, 'logs'))
  const writer = await RotatingLogWriter.create(join(root, 'logs'))
  const reports = new DiagnosticReport(
    log,
    { appVersion: 'test', platform: 'darwin', osVersion: 'test-os', architecture: 'arm64' },
    { messages: writer, root: join(root, 'snapshots') },
  )
  return { root, log, writer, reports, logger: new AppLogger(writer) }
}
it('collects no-ID diagnostics with all retained event/message logs and saves an immutable ZIP', async () => {
  const { root, log, writer, reports, logger } = await setup()
  const id = crypto.randomUUID()
  await log.write({
    schemaVersion: 1,
    time: new Date().toISOString(),
    level: 'error',
    event: 'operation/failed',
    operationId: 'job',
    diagnosticId: id,
    facts: { code: 'app/operation-failed', stage: 'operation' },
  })
  logger.warn('worker warning')
  const preview = await reports.previewReport({ kind: 'recent' }, 1)
  logger.error('later message')
  await writer.flush()
  const path = join(root, 'report.zip')
  await reports.saveReport(preview.previewId, path, 1)
  const files = await unzip(path)
  const manifest = JSON.parse(files['manifest.json'])
  expect(manifest.environment.osVersion).toBe('test-os')
  expect(Object.keys(files).some((n) => n.startsWith('events/'))).toBe(true)
  expect(Object.values(files).join('\n')).toContain('worker warning')
  expect(Object.values(files).join('\n')).not.toContain('later message')
  expect(manifest.diagnosticIds).toEqual([])
  await reports.dispose()
  await writer.dispose()
  await log.dispose()
})
it('rejects other owners, reserves at most two snapshots, and releases capacity', async () => {
  const { reports, writer, log } = await setup()
  const one = await reports.previewReport({ kind: 'recent' }, 1)
  const two = await reports.previewReport({ kind: 'recent' }, 2)
  await expect(reports.saveReport(one.previewId, 'ignored', 2)).rejects.toThrow()
  await expect(reports.previewReport({ kind: 'recent' }, 3)).rejects.toThrow()
  await reports.releaseReport(one.previewId, 1)
  await reports.previewReport({ kind: 'recent' }, 3)
  expect(() => reports.snapshotPath(two.previewId, 1)).toThrow()
  await reports.dispose()
  await writer.dispose()
  await log.dispose()
})
it('exports valid empty diagnostics instead of requiring a previous error', async () => {
  const { root, reports, writer, log } = await setup()
  const p = await reports.previewReport({ kind: 'recent' }, 1)
  await reports.saveReport(p.previewId, join(root, 'empty.zip'), 1)
  expect(JSON.parse((await unzip(join(root, 'empty.zip')))['manifest.json']).files).toEqual([])
  expect(await readFile(join(root, 'empty.zip'))).toBeTruthy()
  await reports.dispose()
  await writer.dispose()
  await log.dispose()
})

it('holds an inspection lease while an owner closes and rejects expired snapshots', async () => {
  const { reports, writer, log } = await setup()
  const preview = await reports.previewReport({ kind: 'recent' }, 7)
  let unblock!: () => void
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  let path = ''
  const inspection = reports.inspectReport(preview.previewId, 7, async (root) => {
    path = root
    await gate
    expect(await readFile(join(root, 'manifest.json'))).toBeTruthy()
  })
  await reports.releaseOwner(7)
  expect(await readFile(join(path, 'manifest.json'))).toBeTruthy()
  unblock()
  await inspection
  await expect(readFile(join(path, 'manifest.json'))).rejects.toThrow()
  await reports.dispose()
  await writer.dispose()
  await log.dispose()
})

it('omits torn records and discloses historical loss counts without double counting rotated summaries', async () => {
  const { root, reports, writer, log, logger } = await setup()
  logger.info('valid message')
  await writer.flush()
  const { appendFile } = await import('node:fs/promises')
  await appendFile(join(root, 'logs/runtime.jsonl'), 'broken\n{"torn":')
  const p = await reports.previewReport({ kind: 'recent' }, 1)
  expect(p.manifest.warnings).toContain('invalid-records')
  await reports.saveReport(p.previewId, join(root, 'damaged.zip'), 1)
  expect(Object.values(await unzip(join(root, 'damaged.zip'))).join('\n')).toContain(
    'valid message',
  )
  expect(Object.values(await unzip(join(root, 'damaged.zip'))).join('\n')).not.toContain('torn')
  await reports.dispose()
  await writer.dispose()
  await log.dispose()
})

it('preserves an existing destination when a snapshot payload becomes unreadable', async () => {
  const { root, reports, writer, log, logger } = await setup()
  logger.info('snapshot payload')
  const p = await reports.previewReport({ kind: 'recent' }, 1)
  const destination = join(root, 'existing.zip')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(destination, 'existing contents')
  await rm(join(reports.snapshotPath(p.previewId, 1), p.manifest.files[0].path))
  await expect(reports.saveReport(p.previewId, destination, 1)).rejects.toThrow()
  expect(await readFile(destination, 'utf8')).toBe('existing contents')
  await reports.dispose()
  await writer.dispose()
  await log.dispose()
})

it('handles snapshot-directory startup failure without an unhandled rejection before collection', async () => {
  const reports = new DiagnosticReport(
    { snapshot: async () => [] },
    { appVersion: 'test', platform: 'test', architecture: 'test' },
    { root: '/dev/null/diagnostic-snapshots' },
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
  await expect(reports.previewReport({ kind: 'recent' }, 1)).rejects.toThrow()
  await reports.dispose()
})

it('reserves capacity during concurrent preparation and expires previews after ten minutes', async () => {
  const { vi } = await import('vitest')
  let unblock!: () => void
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const reports = new DiagnosticReport(
    {
      snapshot: async () => {
        await gate
        return []
      },
    },
    { appVersion: 'test', platform: 'test', architecture: 'test' },
  )
  const first = reports.previewReport({ kind: 'recent' }, 1)
  const second = reports.previewReport({ kind: 'recent' }, 2)
  await expect(reports.previewReport({ kind: 'recent' }, 3)).rejects.toThrow('Too many')
  unblock()
  const p = await first
  await second
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 601_000)
  try {
    expect(() => reports.snapshotPath(p.previewId, 1)).toThrow('expired')
  } finally {
    clock.mockRestore()
    await reports.dispose()
  }
})
