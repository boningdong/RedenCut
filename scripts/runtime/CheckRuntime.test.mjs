import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkRuntime } from './CheckRuntime.mjs'
import { sha256File } from './RuntimeIntegrity.mjs'

async function makeRuntime({
  platform = process.platform,
  arch = process.arch,
  working = true,
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
      runtimeId: 'check-fixture',
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
