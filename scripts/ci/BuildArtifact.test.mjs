import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BUILD_RECORD_PATH, verifyBuildRecord, writeBuildRecord } from './BuildArtifact.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'build-record-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, '.gitignore'), 'out/\ndist-electron/\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }))
  await writeFile(join(root, 'package-lock.json'), '{}')
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('add', '.')
  git('commit', '-qm', 'fixture')
  for (const entry of [
    'main/index.js',
    'preload/index.js',
    'renderer/index.html',
    'renderer/assets/app.js',
  ]) {
    await mkdir(join(root, 'out', entry, '..'), { recursive: true })
    await writeFile(join(root, 'out', entry), entry)
  }
  return { root, platform: 'darwin', arch: 'arm64' }
}

test('records all compiled files and verifies identical source and output', async (t) => {
  const options = await fixture(t)
  const record = await writeBuildRecord(options)
  assert.equal(record.files.length, 4)
  assert.deepEqual(await verifyBuildRecord(options), record)
})

test('rejects modified, missing, additional, and symlinked compiled files', async (t) => {
  for (const change of ['modify', 'missing', 'additional', 'symlink']) {
    const options = await fixture(t)
    await writeBuildRecord(options)
    const target = join(options.root, 'out/main/index.js')
    if (change === 'modify') await writeFile(target, 'tampered')
    if (change === 'missing') await rm(target)
    if (change === 'additional') await writeFile(join(options.root, 'out/unrecorded.js'), 'extra')
    if (change === 'symlink') {
      await rm(target)
      await symlink(join(options.root, 'package.json'), target)
    }
    await assert.rejects(verifyBuildRecord(options), /build|Build|artifact/)
  }
})

test('rejects stale commit, dependency, version, platform, architecture and schema records', async (t) => {
  for (const key of [
    'commit',
    'packageLockSha256',
    'version',
    'platform',
    'arch',
    'schemaVersion',
  ]) {
    const options = await fixture(t)
    const record = await writeBuildRecord(options)
    record[key] = 'wrong'
    await writeFile(join(options.root, BUILD_RECORD_PATH), JSON.stringify(record))
    await assert.rejects(verifyBuildRecord(options), /record/)
  }
})

test('rejects dirty source, unsupported hosts, empty entries, and absent records', async (t) => {
  const options = await fixture(t)
  await assert.rejects(verifyBuildRecord(options), /ENOENT/)
  await assert.rejects(writeBuildRecord({ ...options, platform: 'linux' }), /macOS arm64/)
  await writeFile(join(options.root, 'out/main/index.js'), '')
  await assert.rejects(writeBuildRecord(options), /empty/)
  await writeFile(join(options.root, 'package.json'), '{}')
  await assert.rejects(writeBuildRecord(options), /clean working tree/)
})
