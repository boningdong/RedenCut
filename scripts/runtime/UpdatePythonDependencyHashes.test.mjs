import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { updatePythonDependencyHashes } from './UpdatePythonDependencyHashes.mjs'
import { verifyPythonDependencyInputs } from './RuntimeLock.mjs'

test('updates dependency hashes while preserving the native runtime records', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dependency-hashes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'runtime'))
  await mkdir(join(root, 'speech-worker'))
  await writeFile(
    join(root, 'runtime/runtime-lock.json'),
    JSON.stringify({ runtimeId: 'keep', sources: { keep: true } }),
  )
  await writeFile(join(root, 'speech-worker/pyproject.toml'), 'project')
  await writeFile(join(root, 'speech-worker/uv.lock'), 'lock')
  await updatePythonDependencyHashes(root)
  const lock = JSON.parse(await readFile(join(root, 'runtime/runtime-lock.json')))
  assert.equal(lock.runtimeId, 'keep')
  assert.deepEqual(lock.sources, { keep: true })
  await verifyPythonDependencyInputs(lock, join(root, 'speech-worker'))
})
