import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { parseArguments } from './PrepareRelease.mjs'

const entry = resolve(import.meta.dirname, 'PrepareRelease.mjs')

test('release preparation accepts an explicit model directory without running preparation on import', () => {
  assert.deepEqual(parseArguments(['--models-path', '/models with spaces']), {
    modelsPath: '/models with spaces',
  })
  assert.deepEqual(parseArguments([]), {})
})

test('invalid model path arguments fail before preparation can run commands', () => {
  for (const args of [
    ['--models-path'],
    ['--models-path', '--unknown'],
    ['--models-path', '/a', '--models-path', '/b'],
    ['--unknown'],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Usage:/)
  }
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'redencut-prepare-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, '.gitignore'), 'dist-electron/\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-beta' }))
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ version: '0.1.0-beta', packages: { '': { version: '0.1.0-beta' } } }),
  )
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Release Fixture')
  git('config', 'user.email', 'test@example.invalid')
  git('add', '.')
  git('commit', '-qm', 'fixture')
  return { root }
}

test('preparation forwards the explicit model path to packaging and produces verified release metadata', async (t) => {
  const { prepareRelease } = await import('./PrepareRelease.mjs')
  const { root } = await fixture(t)
  const calls = []
  const models = join(root, 'models with spaces')
  const run = (command, args) => {
    calls.push({ command, args })
    if (command === 'npm' && args[1] === 'package:mac') {
      assert.deepEqual(args, ['run', 'package:mac', '--', '--models-path', models])
      return writePackage()
    }
  }
  async function writePackage() {
    const packaged = join(root, 'dist-electron/package')
    const runtime = join(packaged, 'mac-arm64/RedenCut.app/Contents/Resources/runtime')
    await mkdir(runtime, { recursive: true })
    await writeFile(
      join(runtime, 'manifest.json'),
      JSON.stringify({ runtimeId: 'fixture-runtime' }),
    )
    await writeFile(join(packaged, 'RedenCut-0.1.0-beta-arm64.dmg'), 'fixture dmg')
  }
  await prepareRelease({
    root,
    modelsPath: models,
    environment: { REDENCUT_MODELS_PATH: join(root, 'wrong-model-directory') },
    run,
    platform: 'darwin',
    arch: 'arm64',
  })
  assert.deepEqual(
    calls.filter(({ command }) => command === 'npm').map(({ args }) => args[1]),
    ['runtime:check', 'check', 'package:mac'],
  )
  const record = JSON.parse(
    await readFile(join(root, 'dist-electron/releases/v0.1.0-beta/release.json'), 'utf8'),
  )
  assert.equal(record.runtimeId, 'fixture-runtime')
  assert.equal(record.size, 11)
  assert.match(record.sha256, /^[a-f0-9]{64}$/)
  assert.equal(
    calls.some(({ command }) => command === 'hdiutil'),
    true,
  )
})

test('preparation resolves the environment model directory when no CLI override is supplied', async (t) => {
  const { prepareRelease } = await import('./PrepareRelease.mjs')
  const { root } = await fixture(t)
  const models = join(root, 'environment models')
  let packaged = false
  await assert.rejects(
    prepareRelease({
      root,
      environment: { REDENCUT_MODELS_PATH: models },
      platform: 'darwin',
      arch: 'arm64',
      run: (command, args) => {
        if (command === 'npm' && args[1] === 'package:mac') {
          assert.deepEqual(args, ['run', 'package:mac', '--', '--models-path', models])
          packaged = true
          throw new Error('stop after observing the package boundary')
        }
      },
    }),
    /stop after observing/,
  )
  assert.equal(packaged, true)
})

test('a failed preparation invalidates old metadata and never reaches packaging', async (t) => {
  const { prepareRelease } = await import('./PrepareRelease.mjs')
  const { root } = await fixture(t)
  const destination = join(root, 'dist-electron/releases/v0.1.0-beta')
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'release.json'), '{}')
  const calls = []
  await assert.rejects(
    prepareRelease({
      root,
      platform: 'darwin',
      arch: 'arm64',
      run: (command, args) => {
        calls.push(args[1])
        throw new Error('runtime unavailable')
      },
    }),
    /runtime unavailable/,
  )
  await assert.rejects(readFile(join(destination, 'release.json')), { code: 'ENOENT' })
  assert.deepEqual(calls, ['runtime:check'])
})
