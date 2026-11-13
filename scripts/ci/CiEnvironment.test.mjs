import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const entry = resolve(import.meta.dirname, 'CiEnvironment.mjs')

test('tool version comes from the runtime lock and dependency hashes match', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ci-version-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const output = join(directory, 'output')
  const result = spawnSync(process.execPath, [entry, 'versions'], {
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const lock = JSON.parse(
    await readFile(resolve(import.meta.dirname, '../../runtime/runtime-lock.json'), 'utf8'),
  )
  assert.equal(await readFile(output, 'utf8'), `uv=${lock.buildTools.uv.version}\n`)
})

test('missing model credential and unknown actions fail without revealing secrets', () => {
  for (const action of ['require-model-token', 'unknown']) {
    const result = spawnSync(process.execPath, [entry, action], {
      env: { ...process.env, HF_TOKEN: '' },
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0)
  }
  const ready = spawnSync(process.execPath, [entry, 'require-model-token'], {
    env: { ...process.env, HF_TOKEN: 'fixture-private-token' },
    encoding: 'utf8',
  })
  assert.equal(ready.status, 0)
  assert.equal(ready.stdout + ready.stderr, '')
})
