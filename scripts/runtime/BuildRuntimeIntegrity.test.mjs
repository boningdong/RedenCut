import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  assertLockedPythonDependencyHashes,
  bootstrapUv,
  freshExtractSource,
  requireEmptyOrMatchingBuild,
} from './BuildRuntime.mjs'
import { sha256File } from './RuntimeIntegrity.mjs'

const execFileAsync = promisify(execFile)

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

test('rejects changed Python dependency inputs against the lock', () => {
  const expected = { pyprojectSha256: 'a'.repeat(64), uvLockSha256: 'b'.repeat(64) }
  assert.doesNotThrow(() => assertLockedPythonDependencyHashes(expected, expected))
  assert.throws(
    () =>
      assertLockedPythonDependencyHashes(expected, { ...expected, uvLockSha256: 'c'.repeat(64) }),
    /dependency files do not match/i,
  )
})

test('rejects tampered native build-cache output despite a matching recipe marker', async () => {
  const prefix = await mkdtemp(join(tmpdir(), 'redencut-build-cache-'))
  await mkdir(join(prefix, 'bin'))
  const artifact = join(prefix, 'bin', 'ffmpeg')
  await writeFile(artifact, 'original')
  const recipe = { sourceSha256: 'd'.repeat(64), arguments: ['--locked'] }
  await writeFile(
    join(prefix, '.redencut-build.json'),
    JSON.stringify({
      schemaVersion: 1,
      recipeFingerprint: fingerprint(recipe),
      recipe,
      outputFiles: [{ path: 'bin/ffmpeg', sha256: await sha256File(artifact) }],
    }),
  )
  assert.equal(await requireEmptyOrMatchingBuild(prefix, artifact, recipe), true)

  await writeFile(artifact, 'tampered')
  await assert.rejects(
    requireEmptyOrMatchingBuild(prefix, artifact, recipe),
    /output integrity failure/i,
  )
})

test('fresh source extraction discards locally modified source files before compilation', async () => {
  const workRoot = await mkdtemp(join(tmpdir(), 'redencut-source-cache-'))
  const downloadsRoot = join(workRoot, 'downloads')
  const sourcesRoot = join(workRoot, 'sources')
  const fixtureRoot = join(workRoot, 'fixture', 'component-1.0')
  await mkdir(fixtureRoot, { recursive: true })
  await mkdir(downloadsRoot)
  await writeFile(join(fixtureRoot, 'source.c'), 'pinned source')
  await execFileAsync('tar', [
    '-czf',
    join(downloadsRoot, 'component.tar.gz'),
    '-C',
    join(workRoot, 'fixture'),
    'component-1.0',
  ])
  const source = { archive: 'component.tar.gz', sourceDirectory: 'component-1.0' }
  await freshExtractSource(source, downloadsRoot, sourcesRoot)
  await writeFile(join(sourcesRoot, 'component-1.0', 'source.c'), 'local modification')

  await freshExtractSource(source, downloadsRoot, sourcesRoot)

  assert.equal(
    await readFile(join(sourcesRoot, 'component-1.0', 'source.c'), 'utf8'),
    'pinned source',
  )
})

test('pinned uv bootstrap replaces a tampered extracted executable', async () => {
  const workRoot = await mkdtemp(join(tmpdir(), 'redencut-uv-cache-'))
  const downloadsRoot = join(workRoot, 'downloads')
  const fixtureRoot = join(workRoot, 'fixture', 'uv-aarch64-apple-darwin')
  const archive = 'uv.tar.gz'
  await mkdir(fixtureRoot, { recursive: true })
  await mkdir(downloadsRoot)
  const fixtureExecutable = join(fixtureRoot, 'uv')
  await writeFile(fixtureExecutable, '#!/bin/sh\necho "uv 0.12.12 (fixture)"\n')
  await chmod(fixtureExecutable, 0o755)
  await execFileAsync('tar', [
    '-czf',
    join(downloadsRoot, archive),
    '-C',
    join(workRoot, 'fixture'),
    'uv-aarch64-apple-darwin',
  ])
  const source = {
    version: '0.12.12',
    url: 'https://invalid.example/unused',
    archive,
    sha256: await sha256File(join(downloadsRoot, archive)),
    executable: 'uv-aarch64-apple-darwin/uv',
    executableSha256: await sha256File(fixtureExecutable),
  }
  const executable = await bootstrapUv({ buildTools: { uv: source } }, workRoot)
  await writeFile(executable, '#!/bin/sh\necho tampered\n')

  await bootstrapUv({ buildTools: { uv: source } }, workRoot)

  assert.equal(await sha256File(executable), source.executableSha256)
})
