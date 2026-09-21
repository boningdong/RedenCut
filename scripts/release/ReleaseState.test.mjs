import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readReleaseState, verifyReleaseArtifact } from './ReleaseState.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'test@example.invalid')
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-beta' }))
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ version: '0.1.0-beta', packages: { '': { version: '0.1.0-beta' } } }),
  )
  git('add', '.')
  git('commit', '-qm', 'fixture')
  return { root, git }
}

test('release identity binds the beta version to the current commit', async (t) => {
  const { root, git } = await fixture(t)
  const state = await readReleaseState(root)
  assert.equal(state.tag, 'v0.1.0-beta')
  assert.equal(state.prerelease, true)
  assert.equal(state.commit, git('rev-parse', 'HEAD'))
})

test('uncommitted source cannot be presented as a release commit', async (t) => {
  const { root } = await fixture(t)
  await writeFile(join(root, 'new-source.js'), 'changed')
  await assert.rejects(readReleaseState(root), /clean working tree/)
})

test('a committed mismatched lockfile is rejected', async (t) => {
  const { root, git } = await fixture(t)
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }),
  )
  git('commit', '-qam', 'mismatch')
  await assert.rejects(readReleaseState(root), /lockfile/)
})

test('changed artifact bytes or source commit prevent upload', async (t) => {
  const { root } = await fixture(t)
  const state = await readReleaseState(root)
  const artifact = join(tmpdir(), `redencut-artifact-${state.commit}.dmg`)
  t.after(() => rm(artifact, { force: true }))
  await writeFile(artifact, 'abc')
  const record = {
    ...state,
    sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    size: 3,
  }
  await verifyReleaseArtifact(state, record, artifact)
  await assert.rejects(
    verifyReleaseArtifact({ ...state, commit: '0'.repeat(40) }, record, artifact),
    /commit/,
  )
  await writeFile(artifact, 'abd')
  await assert.rejects(verifyReleaseArtifact(state, record, artifact), /checksum/)
})

test('tag validation rejects version mismatch and a tag for another commit', async (t) => {
  const { assertReleaseTag } = await import('./ReleaseState.mjs')
  const { root } = await fixture(t)
  const state = await readReleaseState(root)
  assertReleaseTag(state, 'v0.1.0-beta', state.commit)
  assert.throws(() => assertReleaseTag(state, 'v0.2.0', state.commit), /tag/)
  assert.throws(() => assertReleaseTag(state, state.tag, '0'.repeat(40)), /commit/)
})
