import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sha256File } from './RuntimeIntegrity.mjs'
import { installRuntimeGeneration } from './RuntimeInstaller.mjs'

async function makeBundle({
  manifestFiles,
  executables,
  working = true,
  platform = process.platform,
  executableBody,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'redencut-runtime-bundle-'))
  await mkdir(join(root, 'bin'), { recursive: true })
  const executable =
    executableBody ?? (working ? '#!/bin/sh\necho runtime\n' : '#!/bin/sh\nexit 23\n')
  await writeFile(join(root, 'bin', 'ffmpeg'), executable)
  await writeFile(join(root, 'bin', 'ffprobe'), executable)
  await chmod(join(root, 'bin', 'ffmpeg'), 0o755)
  await chmod(join(root, 'bin', 'ffprobe'), 0o755)

  const files = manifestFiles ?? [
    { path: 'bin/ffmpeg', sha256: await sha256File(join(root, 'bin', 'ffmpeg')) },
    { path: 'bin/ffprobe', sha256: await sha256File(join(root, 'bin', 'ffprobe')) },
  ]
  await writeFile(
    join(root, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runtimeId: 'test-runtime',
        platform,
        arch: process.arch,
        executables: executables ?? {
          ffmpeg: 'bin/ffmpeg',
          ffprobe: 'bin/ffprobe',
        },
        components: [
          {
            name: 'ffmpeg',
            version: '7.1.5',
            license: 'LGPL-2.1-or-later',
            sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz',
          },
        ],
        files,
      },
      null,
      2,
    )}\n`,
  )
  return root
}

test('rejects a staged runtime when a file hash does not match', async () => {
  const bundleRoot = await makeBundle()
  await writeFile(join(bundleRoot, 'bin', 'ffmpeg'), 'tampered')
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))

  await assert.rejects(
    installRuntimeGeneration({ bundleRoot, destinationRoot: join(installRoot, 'current') }),
    /integrity.*bin\/ffmpeg/i,
  )
})

test('rejects traversal paths before reading outside the staged runtime', async () => {
  const bundleRoot = await makeBundle({
    manifestFiles: [{ path: '../outside', sha256: '0'.repeat(64) }],
  })
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))

  await assert.rejects(
    installRuntimeGeneration({ bundleRoot, destinationRoot: join(installRoot, 'current') }),
    /unsafe runtime-relative path/i,
  )
})

test('does not replace a working runtime when staged installation is incomplete', async () => {
  const bundleRoot = await makeBundle({
    executables: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/missing' },
  })
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))
  const destinationRoot = join(installRoot, 'current')
  await mkdir(destinationRoot)
  await writeFile(join(destinationRoot, 'marker'), 'working-generation')

  await assert.rejects(
    installRuntimeGeneration({ bundleRoot, destinationRoot }),
    /missing.*bin\/missing/i,
  )
  assert.equal(await readFile(join(destinationRoot, 'marker'), 'utf8'), 'working-generation')
})

test('preserves relative links when relocating a portable runtime', async () => {
  const bundleRoot = await makeBundle()
  await writeFile(join(bundleRoot, 'bin', 'python3.11'), '#!/bin/sh\necho python\n')
  await chmod(join(bundleRoot, 'bin', 'python3.11'), 0o755)
  await symlink('python3.11', join(bundleRoot, 'bin', 'python3'))
  const manifest = JSON.parse(await readFile(join(bundleRoot, 'manifest.json'), 'utf8'))
  manifest.executables.python = 'bin/python3'
  manifest.files.push({
    path: 'bin/python3',
    sha256: await sha256File(join(bundleRoot, 'bin', 'python3')),
  })
  manifest.files.push({
    path: 'bin/python3.11',
    sha256: await sha256File(join(bundleRoot, 'bin', 'python3.11')),
  })
  await writeFile(join(bundleRoot, 'manifest.json'), JSON.stringify(manifest))
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))
  const destinationRoot = join(installRoot, 'current')

  await installRuntimeGeneration({ bundleRoot, destinationRoot })

  assert.equal(await readlink(join(destinationRoot, 'bin', 'python3')), 'python3.11')
})

test('does not replace a working runtime when a hash-valid executable fails its load probe', async () => {
  const bundleRoot = await makeBundle({ working: false })
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))
  const destinationRoot = join(installRoot, 'current')
  await mkdir(destinationRoot)
  await writeFile(join(destinationRoot, 'marker'), 'working-generation')

  await assert.rejects(
    installRuntimeGeneration({ bundleRoot, destinationRoot }),
    /readiness probe failed \(load-failed\)/i,
  )
  assert.equal(await readFile(join(destinationRoot, 'marker'), 'utf8'), 'working-generation')
})

test('does not replace a working runtime with a valid runtime for another platform', async () => {
  const wrongPlatform = process.platform === 'darwin' ? 'linux' : 'darwin'
  const bundleRoot = await makeBundle({ platform: wrongPlatform })
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))
  const destinationRoot = join(installRoot, 'current')
  await mkdir(destinationRoot)
  await writeFile(join(destinationRoot, 'marker'), 'working-generation')

  await assert.rejects(
    installRuntimeGeneration({ bundleRoot, destinationRoot }),
    /readiness probe failed \(wrong-architecture\)/i,
  )
  assert.equal(await readFile(join(destinationRoot, 'marker'), 'utf8'), 'working-generation')
})

test('restores the prior runtime when the final-location readiness probe fails', async () => {
  const bundleRoot = await makeBundle({
    executableBody: '#!/bin/sh\ncase "$PWD" in *.staging-*) exit 0;; *) exit 23;; esac\n',
  })
  const installRoot = await mkdtemp(join(tmpdir(), 'redencut-runtime-install-'))
  const destinationRoot = join(installRoot, 'current')
  await mkdir(destinationRoot)
  await writeFile(join(destinationRoot, 'marker'), 'working-generation')

  await assert.rejects(
    installRuntimeGeneration({ bundleRoot, destinationRoot }),
    /readiness probe failed \(load-failed\)/i,
  )
  assert.equal(await readFile(join(destinationRoot, 'marker'), 'utf8'), 'working-generation')
})
