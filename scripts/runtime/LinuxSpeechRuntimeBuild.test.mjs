import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readRuntimeLock } from './RuntimeLock.mjs'
import { writeAudioManifest } from '../../harness/container/build/audio/WriteAudioManifest.mjs'
import { writeSpeechManifest } from '../../harness/container/build/speech/WriteSpeechManifest.mjs'
import { prepareSpeechDependencies } from '../../harness/container/build/speech/BuildSpeechRuntime.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'linux-runtime-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('speech manifest follows resolved source definitions and inventories bundled data', async (t) => {
  const runtimeRoot = await fixture(t)
  await mkdir(join(runtimeRoot, 'nltk_data'))
  await writeFile(join(runtimeRoot, 'nltk_data', 'tables'), 'bundled data')
  const lock = await readRuntimeLock({ platform: 'linux' })
  lock.sources.whisperCpp = { ...lock.sources.whisperCpp, version: 'changed-whisper-version' }
  lock.sources.python = { ...lock.sources.python, version: 'changed-python-version' }
  await writeAudioManifest({ runtimeRoot, lock, pulseVersion: 'fixture-pulse' })
  await writeSpeechManifest({ runtimeRoot, lock })
  const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'))
  assert.equal(
    manifest.components.find(({ name }) => name === 'whisper.cpp').version,
    'changed-whisper-version',
  )
  assert.equal(
    manifest.components.find(({ name }) => name === 'CPython').version,
    'changed-python-version',
  )
  assert.equal(
    manifest.components.find(({ name }) => name === 'punktTab').sourceSha256,
    lock.data.punktTab.sha256,
  )
  assert.ok(manifest.files.some(({ path }) => path === 'nltk_data/tables'))
  assert.ok(manifest.files.every(({ path }) => path !== 'manifest.json'))
})

async function pythonBuildFixture(t) {
  const root = await fixture(t)
  const tools = join(root, 'tools')
  const workerRoot = join(root, 'worker')
  await mkdir(tools)
  await mkdir(workerRoot)
  const logPath = join(root, 'commands.jsonl')
  const command = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.REDENCUT_TEST_BUILD_COMMAND_LOG, JSON.stringify({args: process.argv.slice(2), env: {UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR, UV_PROJECT_ENVIRONMENT: process.env.UV_PROJECT_ENVIRONMENT, UV_NO_BINARY_PACKAGE: process.env.UV_NO_BINARY_PACKAGE}}) + '\\n')
`
  for (const name of ['uv', 'python3']) await writeFile(join(tools, name), command, { mode: 0o755 })
  const previousLogPath = process.env.REDENCUT_TEST_BUILD_COMMAND_LOG
  process.env.REDENCUT_TEST_BUILD_COMMAND_LOG = logPath
  const previousPath = process.env.PATH
  process.env.PATH = tools + ':' + previousPath
  t.after(() => {
    process.env.PATH = previousPath
    if (previousLogPath === undefined) delete process.env.REDENCUT_TEST_BUILD_COMMAND_LOG
    else process.env.REDENCUT_TEST_BUILD_COMMAND_LOG = previousLogPath
  })
  await writeFile(join(workerRoot, 'pyproject.toml'), 'project fixture')
  await writeFile(join(workerRoot, 'uv.lock'), 'lock fixture')
  const digest = (text) => createHash('sha256').update(text).digest('hex')
  const lock = {
    buildTools: { uv: { version: '8.9' } },
    sources: { python: { version: '9.8.7' } },
    pythonDependencies: {
      pyprojectSha256: digest('project fixture'),
      uvLockSha256: digest('lock fixture'),
    },
  }
  return { runtimeRoot: join(root, 'runtime'), workerRoot, lock, logPath }
}

test('Linux Python setup consumes locked tool and interpreter versions', async (t) => {
  const f = await pythonBuildFixture(t)
  await prepareSpeechDependencies(f)
  const calls = (await readFile(f.logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(calls[0].args.at(-1), 'uv==8.9')
  assert.deepEqual(calls[1].args, ['python', 'install', '9.8.7'])
  assert.deepEqual(calls[2].args, [
    'sync',
    '--python',
    '9.8.7',
    '--frozen',
    '--no-dev',
    '--no-install-project',
  ])
  assert.equal(calls[2].env.UV_PROJECT_ENVIRONMENT, join(f.runtimeRoot, 'speech-env'))
  assert.equal(calls[2].env.UV_NO_BINARY_PACKAGE, 'av')
})

test('Linux Python setup rejects dependency drift before running installers', async (t) => {
  const f = await pythonBuildFixture(t)
  await writeFile(join(f.workerRoot, 'uv.lock'), 'drifted input')
  await assert.rejects(prepareSpeechDependencies(f), /dependency files do not match/)
  await assert.rejects(readFile(f.logPath), { code: 'ENOENT' })
})
