import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { AppLogEventSchema, type AppLogEvent } from '../../shared/diagnostics.types'
import { DiagnosticLog } from './DiagnosticLog'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'diagnostic-log-'))
  directories.push(path)
  return path
}

it('records ordered safe milestones and rejects private facts', async () => {
  const log = await DiagnosticLog.create(await directory())
  const event: AppLogEvent = {
    schemaVersion: 1,
    time: new Date().toISOString(),
    level: 'info',
    event: 'speech/alignment-started',
    operationId: 'job-1',
    facts: { segmentCount: 2 },
  }
  await log.write(event)
  await log.write({
    ...event,
    level: 'error',
    event: 'operation/failed',
    diagnosticId: crypto.randomUUID(),
    facts: { code: 'speech/alignment-inference-failed', stage: 'aligning' },
  })
  expect((await log.readRecent()).map((entry) => entry.event)).toEqual([
    'speech/alignment-started',
    'operation/failed',
  ])
  expect((await log.readRecent())[0].operationId).not.toBe('job-1')
  expect(
    AppLogEventSchema.safeParse({ ...event, facts: { transcript: 'private words' } }).success,
  ).toBe(false)
  await log.dispose()
})

it('rotates, prunes old files and keeps a bounded file count', async () => {
  const path = await directory()
  const log = await DiagnosticLog.create(path, { maxBytes: 160, maxFiles: 2, maxAgeDays: 14 })
  for (let index = 0; index < 8; index++) {
    await log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'info',
      event: 'speech/alignment-started',
      operationId: `job-${index}`,
      facts: { segmentCount: index },
    })
  }
  await log.flush()
  expect(
    (await readdir(path)).filter((name) => name.endsWith('.jsonl')).length,
  ).toBeLessThanOrEqual(2)
  await log.dispose()
})

it('keeps operation successful if filesystem logging fails', async () => {
  const fallback = vi.fn()
  const log = await DiagnosticLog.create(await directory(), {
    fallback,
    append: async () => {
      throw new Error('/private/audio.wav')
    },
  })
  await expect(
    log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'info',
      event: 'speech/alignment-started',
      operationId: 'job',
      facts: { segmentCount: 1 },
    }),
  ).resolves.toBeUndefined()
  expect(fallback).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(fallback.mock.calls)).not.toContain('/private/')
  await expect(
    log.write({
      schemaVersion: 1,
      time: new Date().toISOString(),
      level: 'info',
      event: 'speech/alignment-started',
      operationId: 'job',
      facts: { transcript: 'private' },
    } as never),
  ).resolves.toBeUndefined()
  await log.dispose()
})

it('prunes archived files older than retention at startup', async () => {
  const path = await directory()
  const old = join(path, 'application-100-old.jsonl')
  const active = join(path, 'application.jsonl')
  await writeFile(old, '{}\n')
  await writeFile(active, '{}\n')
  const earlier = new Date(Date.now() - 20 * 86400_000)
  await utimes(old, earlier, earlier)
  await utimes(active, earlier, earlier)
  await DiagnosticLog.create(path, { maxAgeDays: 14 })
  expect(await readdir(path)).not.toContain('application-100-old.jsonl')
  expect(await readdir(path)).not.toContain('application.jsonl')
})

it('uses the first event time when a low-volume log has a recent file mtime', async () => {
  const path = await directory()
  const old = join(path, 'application.jsonl')
  await writeFile(
    old,
    JSON.stringify({
      schemaVersion: 1,
      time: new Date(Date.now() - 20 * 86400_000).toISOString(),
      level: 'info',
      event: 'speech/alignment-started',
      operationId: 'opaque',
      facts: { segmentCount: 1 },
    }) + '\n',
  )
  const log = await DiagnosticLog.create(path, { maxAgeDays: 14 })
  expect(await log.readRecent()).toEqual([])
  expect(await readdir(path)).not.toContain('application.jsonl')
})
