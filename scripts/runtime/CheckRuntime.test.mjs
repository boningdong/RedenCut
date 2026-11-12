import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { checkRuntime } from './CheckRuntime.mjs'
import { sha256File } from './RuntimeIntegrity.mjs'

async function makeRuntime({
  platform = process.platform,
  arch = process.arch,
  working = true,
  runtimeId = 'check-fixture',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'redencut-runtime-check-'))
  await mkdir(join(root, 'bin'))
  const executableBody = working
    ? '#!/bin/sh\necho "ffmpeg version 7.1.5"\n'
    : '#!/bin/sh\nexit 23\n'
  for (const name of ['ffmpeg', 'ffprobe']) {
    await writeFile(join(root, 'bin', name), executableBody)
    await chmod(join(root, 'bin', name), 0o755)
  }
  const files = await Promise.all(
    ['ffmpeg', 'ffprobe'].map(async (name) => ({
      path: `bin/${name}`,
      sha256: await sha256File(join(root, 'bin', name)),
    })),
  )
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      runtimeId,
      platform,
      arch,
      executables: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe' },
      components: [
        {
          name: 'ffmpeg',
          version: '7.1.5',
          license: 'LGPL-2.1-or-later',
          sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz',
        },
      ],
      files,
    }),
  )
  return root
}

test('distinguishes a missing runtime from an incompatible platform runtime', async () => {
  const missingRoot = join(await mkdtemp(join(tmpdir(), 'redencut-runtime-missing-')), 'absent')
  assert.equal((await checkRuntime(missingRoot)).status, 'missing')

  const wrongPlatform = process.platform === 'darwin' ? 'linux' : 'darwin'
  const incompatibleRoot = await makeRuntime({ platform: wrongPlatform })
  const result = await checkRuntime(incompatibleRoot)
  assert.equal(result.status, 'wrong-architecture')
  assert.match(result.message, new RegExp(wrongPlatform))
})

test('reports integrity failure before attempting executable loads', async () => {
  const root = await makeRuntime()
  await writeFile(join(root, 'bin', 'ffmpeg'), 'tampered')
  const result = await checkRuntime(root)
  assert.equal(result.status, 'integrity-failed')
  assert.match(result.message, /bin\/ffmpeg/)
})

test('reports load failures and accepts executable runtimes that load', async () => {
  if (process.platform === 'win32') return
  const failingRoot = await makeRuntime({ working: false })
  const failure = await checkRuntime(failingRoot)
  assert.equal(failure.status, 'load-failed')
  assert.match(failure.message, /ffmpeg/)

  const readyRoot = await makeRuntime()
  const ready = await checkRuntime(readyRoot)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.runtimeId, 'check-fixture')
})

test('runtime check CLI selects an explicit path, then environment, then its default', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'redencut-check-cli-'))
  const environmentRoot = await makeRuntime({ runtimeId: 'environment-runtime' })
  const explicitRoot = await makeRuntime({ runtimeId: 'explicit-runtime' })
  const defaultRoot = await makeRuntime({ runtimeId: 'default-runtime' })
  t.after(() =>
    Promise.all(
      [cwd, environmentRoot, explicitRoot, defaultRoot].map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    ),
  )
  const installedDefault = join(cwd, '.runtime', `${process.platform}-${process.arch}`)
  await mkdir(join(cwd, '.runtime'))
  await rename(defaultRoot, installedDefault)
  const environment = { ...process.env }
  delete environment.REDENCUT_RUNTIME_ROOT
  const entry = resolve(import.meta.dirname, 'CheckRuntime.mjs')
  for (const [args, override, expected] of [
    [[], environmentRoot, 'environment-runtime'],
    [['--runtime-root', explicitRoot], environmentRoot, 'explicit-runtime'],
    [[explicitRoot], environmentRoot, 'explicit-runtime'],
    [[], undefined, 'default-runtime'],
    [[], '', 'default-runtime'],
  ]) {
    const env = { ...environment }
    if (override !== undefined) env.REDENCUT_RUNTIME_ROOT = override
    const result = spawnSync(process.execPath, [entry, ...args], { cwd, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(JSON.parse(result.stdout).runtimeId, expected)
  }
})

test('can verify integrity without loading executables', async (t) => {
  const root = await makeRuntime({ working: false })
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = await checkRuntime(root, { loadExecutables: false })
  assert.equal(result.status, 'ready')
  assert.equal(result.manifest.runtimeId, 'check-fixture')
})

test('CLI reports a failed base check without attempting optional alignment', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-check-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, 'CheckRuntime.mjs'),
      '--runtime-root',
      join(root, 'missing-runtime'),
      '--models-root',
      join(root, 'missing-models'),
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 1, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.status, 'missing')
  assert.equal('manifest' in summary, false)
  assert.equal('alignmentOffline' in summary, false)
})
