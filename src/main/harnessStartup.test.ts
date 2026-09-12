import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { configureHarnessStartup } from './harnessStartup'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

test('leaves normal application paths unchanged without explicit harness opt-in', () => {
  const paths: Record<string, string> = {}
  expect(
    configureHarnessStartup(
      {
        setPath: (name, value) => {
          paths[name] = value
        },
      },
      {},
    ),
  ).toBe(false)
  expect(paths).toEqual({})
})

test('sets isolated userData, sessionData and temp paths without touching other files', () => {
  const root = mkdtempSync(join(tmpdir(), 'redencut-startup-test-'))
  roots.push(root)
  writeFileSync(join(root, 'untouched'), 'user-data')
  const paths: Record<string, string> = {}
  const runId = '318932a4-3c50-4a27-a9f8-0288a189b5d7'
  const runDirectory = join(root, runId)
  expect(
    configureHarnessStartup(
      {
        setPath: (name, value) => {
          paths[name] = value
        },
      },
      {
        REDENCUT_HARNESS_RUN_DIRECTORY: runDirectory,
        REDENCUT_HARNESS_RUN_ID: runId,
      },
    ),
  ).toBe(true)
  expect(paths).toEqual({
    userData: join(runDirectory, 'user-data'),
    sessionData: join(runDirectory, 'session-data'),
    temp: join(runDirectory, 'temporary'),
  })
  expect(readFileSync(join(root, 'untouched'), 'utf8')).toBe('user-data')
})

test.each(['relative/path', '/', '/tmp/unrelated'])(
  'rejects unsafe or inconsistent run directory %s',
  (runDirectory) => {
    expect(() =>
      configureHarnessStartup(
        { setPath: () => {} },
        {
          REDENCUT_HARNESS_RUN_DIRECTORY: runDirectory,
          REDENCUT_HARNESS_RUN_ID: '318932a4-3c50-4a27-a9f8-0288a189b5d7',
        },
      ),
    ).toThrow('INVALID_HARNESS_CONFIGURATION')
  },
)
