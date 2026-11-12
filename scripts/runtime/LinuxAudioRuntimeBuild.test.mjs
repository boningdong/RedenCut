import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readRuntimeLock } from './RuntimeLock.mjs'
import { writeAudioManifest } from '../../harness/container/build/audio/WriteAudioManifest.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'linux-runtime-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('audio manifest follows resolved source definitions and excludes its own record', async (t) => {
  const runtimeRoot = await fixture(t)
  await mkdir(join(runtimeRoot, 'lib'))
  await writeFile(join(runtimeRoot, 'lib', 'sample.so'), 'fixture library')
  const lock = await readRuntimeLock({ platform: 'linux' })
  lock.sources.ffmpeg = { ...lock.sources.ffmpeg, version: 'changed-shared-version' }
  await writeAudioManifest({ runtimeRoot, lock, pulseVersion: 'fixture-pulse' })
  let manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'))
  assert.equal(
    manifest.components.find(({ name }) => name === 'ffmpeg').version,
    'changed-shared-version',
  )
  assert.equal(manifest.components.find(({ name }) => name === 'lame').version, '3.100')
  assert.ok(manifest.files.some(({ path }) => path === 'lib/sample.so'))
  assert.ok(manifest.files.every(({ path }) => path !== 'manifest.json'))
  await writeAudioManifest({ runtimeRoot, lock, pulseVersion: 'fixture-pulse' })
  manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'))
  assert.ok(manifest.files.every(({ path }) => path !== 'manifest.json'))
})
