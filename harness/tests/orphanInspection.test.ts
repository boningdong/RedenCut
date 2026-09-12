import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { inspectOrphanRuns } from '../runtime/orphanInspection'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

test('reports only a dead host with an exact still-live application identity and run marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'redencut-orphan-test-'))
  roots.push(root)
  const runId = 'bd1f4ec8-3b8a-4d5f-b321-7c344366ae08'
  const run = join(root, runId)
  mkdirSync(run)
  const application = {
    pid: 20,
    startedAt: 'app-start',
    command: `Electron --redencut-harness-run-id=${runId}`,
  }
  const host = { pid: 10, startedAt: 'host-start', command: 'node harness/server.ts' }
  writeFileSync(join(run, 'manifest.json'), JSON.stringify({ runId, host, application }))
  expect(inspectOrphanRuns(root, (pid) => (pid === 20 ? application : null))).toEqual([
    {
      runId,
      runDirectory: run,
      application,
      recovery:
        'Manual recovery required; revalidate process identity before terminating. Unsaved state may be lost.',
    },
  ])
  expect(
    inspectOrphanRuns(root, (pid) =>
      pid === 20 ? { ...application, startedAt: 'reused-pid' } : null,
    ),
  ).toEqual([])
  expect(inspectOrphanRuns(root, (pid) => (pid === 20 ? application : host))).toEqual([])
})
