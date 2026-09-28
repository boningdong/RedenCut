import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import test from 'node:test'

import { sha256File } from './RuntimeIntegrity.mjs'

import { assertSafeInstallDestination, parseArguments, setupRuntime } from './SetupRuntime.mjs'

test('setup accepts an explicit nested release runtime and rejects broad destructive targets', async () => {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'redencut-release-'))
  assert.doesNotThrow(() => assertSafeInstallDestination(join(stagingRoot, 'resources', 'runtime')))
  assert.throws(
    () => assertSafeInstallDestination(parse(stagingRoot).root),
    /unsafe runtime destination/i,
  )
  assert.throws(() => assertSafeInstallDestination(process.cwd()), /project root/i)
})

test('parses only tools setup arguments and rejects retired model flags', () => {
  assert.deepEqual(parseArguments(['--bundle', '/bundle', '--runtime-root', '/runtime']), {
    bundleRoot: '/bundle',
    runtimeRoot: '/runtime',
  })
  for (const flag of ['--models-only', '--skip-models', '--models-root', '--import-model'])
    assert.throws(() => parseArguments([flag]), /Unknown SetupRuntime argument/)
})

test('rejects missing path flag values before setup can start a build', () => {
  for (const flag of ['--bundle', '--runtime-root']) {
    assert.throws(() => parseArguments([flag]), new RegExp(`${flag} requires`))
    assert.throws(() => parseArguments([flag, '--runtime-root']), new RegExp(`${flag} requires`))
  }
})

test('tools setup installs a verified bundle and returns only the runtime manifest', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-tools-setup-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const bundleRoot = join(root, 'bundle')
  await mkdir(join(bundleRoot, 'bin'), { recursive: true })
  const files = []
  for (const name of ['ffmpeg', 'ffprobe']) {
    const path = join(bundleRoot, 'bin', name)
    await writeFile(path, '#!/bin/sh\necho runtime\n')
    await chmod(path, 0o755)
    files.push({ path: `bin/${name}`, sha256: await sha256File(path) })
  }
  const runtimeManifest = {
    schemaVersion: 1,
    runtimeId: 'tools-only-runtime',
    platform: process.platform,
    arch: process.arch,
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
  }
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify(runtimeManifest))
  const runtimeRoot = join(root, 'installed')
  const result = await setupRuntime({
    bundleRoot,
    environment: {
      REDENCUT_RUNTIME_ROOT: runtimeRoot,
      REDENCUT_MODELS_PATH: join(root, 'unused-models'),
    },
  })
  assert.deepEqual(result, { runtimeManifest })
  assert.equal(await readFile(join(runtimeRoot, 'bin/ffmpeg'), 'utf8'), '#!/bin/sh\necho runtime\n')
  await assert.rejects(setupRuntime({ bundleRoot, runtimeRoot: bundleRoot }), /must be different/)
})
