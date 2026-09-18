import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import test from 'node:test'

import { assertSafeInstallDestination } from './SetupRuntime.mjs'

test('setup accepts an explicit nested release runtime and rejects broad destructive targets', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-release-'))
  assert.doesNotThrow(() => assertSafeInstallDestination(join(stagingRoot, 'resources', 'runtime')))
  assert.throws(
    () => assertSafeInstallDestination(parse(stagingRoot).root),
    /unsafe runtime destination/i,
  )
  assert.throws(() => assertSafeInstallDestination(process.cwd()), /project root/i)
})
