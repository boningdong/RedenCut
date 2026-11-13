import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('release validation rejects unknown arguments before platform or source checks', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [resolve(import.meta.dirname, 'VerifyReleaseTag.mjs'), '--skip'],
        { stdio: 'pipe' },
      ),
    /Usage:/,
  )
})

test(
  'manual validation skips only tag matching and formal validation still requires a tag',
  {
    skip: process.platform !== 'darwin' || process.arch !== 'arm64',
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-release-source-'))
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
    const commit = git('rev-parse', 'HEAD')
    const verify = (args, tag = '', source = commit) =>
      execFileSync(
        process.execPath,
        [resolve(import.meta.dirname, 'VerifyReleaseTag.mjs'), ...args],
        {
          cwd: root,
          env: { ...process.env, RELEASE_TAG: tag, RELEASE_COMMIT: source },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      )
    assert.match(verify(['--without-tag']), /Packaging v0.1.0-beta/)
    assert.match(verify([], 'v0.1.0-beta'), /Packaging v0.1.0-beta/)
    assert.throws(() => verify([]), /tag must match/)
    assert.throws(() => verify([], 'v9.0.0'), /tag must match/)
    assert.throws(() => verify(['--without-tag'], '', '0'.repeat(40)), /commit must match/)
    assert.throws(() => verify(['--without-tag'], '', ''), /commit must match/)
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ version: '9.0.0' }))
    git('commit', '-qam', 'mismatch')
    assert.throws(
      () => verify(['--without-tag'], '', git('rev-parse', 'HEAD')),
      /lockfile versions must match/,
    )
    await writeFile(join(root, 'pending.txt'), 'pending')
    assert.throws(() => verify(['--without-tag']), /clean working tree/)
  },
)
