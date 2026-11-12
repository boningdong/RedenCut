import assert from 'node:assert/strict'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { createVitest } from 'vitest/node'

const root = resolve(import.meta.dirname, '../..')

function assertPartition(all, unit, integration) {
  assert.ok(unit.length > 0 && integration.length > 0, 'Both test groups must contain files')
  assert.deepEqual(
    unit.filter((file) => integration.includes(file)),
    [],
    'Duplicate test ownership',
  )
  assert.deepEqual([...unit, ...integration].sort(), [...all].sort(), 'Missing test ownership')
}

async function discover(config) {
  const vitest = await createVitest('test', { root, config, watch: false })
  try {
    return (await vitest.globTestSpecifications()).map((specification) => specification.moduleId)
  } finally {
    await vitest.close()
  }
}

test('unit and integration discovery partition all application and harness-helper tests', async () => {
  const all = [
    ...globSync('src/**/*.{test,spec}.{ts,tsx}', { cwd: root }),
    ...globSync('harness/tests/**/*.test.ts', { cwd: root }),
  ].map((file) => resolve(root, file))
  assertPartition(
    all,
    await discover('vitest.config.unit.ts'),
    await discover('vitest.config.integration.ts'),
  )
  assert.deepEqual((await discover('vitest.config.ts')).sort(), all.sort())
})

test('membership guard rejects missing or duplicate test files', () => {
  assert.throws(() => assertPartition(['a', 'b', 'c'], ['a'], ['b']), /Missing/)
  assert.throws(() => assertPartition(['a', 'b'], ['a', 'b'], ['b']), /Duplicate/)
})
