#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const options = {}
for (let index = 0; index < args.length; index += 2) {
  if (!['--resources-dir', '--bundle'].includes(args[index]) || !args[index + 1]) {
    throw new Error(
      'Usage: npm run runtime:stage -- --resources-dir NEW_DIRECTORY [--bundle RUNTIME_BUNDLE]',
    )
  }
  options[args[index]] = args[index + 1]
}
if (!options['--resources-dir'])
  throw new Error('--resources-dir must name a new release resources directory')
const destination = resolve(options['--resources-dir'])
try {
  await lstat(destination)
  throw new Error(`Refusing to replace an existing resources directory: ${destination}`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const bundle = resolve(
  options['--bundle'] ?? join(repository, '.runtime', `${process.platform}-${process.arch}`),
)
const staging = join(dirname(destination), `.redencut-release-${randomUUID()}`)
await mkdir(staging, { recursive: true })
try {
  execFileSync(
    process.execPath,
    [
      join(repository, 'scripts/runtime/SetupRuntime.mjs'),
      '--bundle',
      bundle,
      '--runtime-root',
      join(staging, 'runtime'),
    ],
    { stdio: 'inherit' },
  )
  await cp(join(repository, 'speech-worker/src'), join(staging, 'speech-worker/src'), {
    recursive: true,
    filter: (path) => !path.split('/').includes('__pycache__') && !path.endsWith('.pyc'),
  })
  await cp(
    join(repository, 'speech-worker/models.json'),
    join(staging, 'speech-worker/models.json'),
  )
  const notices = join(staging, 'third-party-notices')
  await mkdir(notices)
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    await cp(
      join(repository, 'node_modules/electron/dist', name),
      join(notices, `Electron-${name}`),
    )
  }
  await cp(join(repository, 'LICENSE'), join(staging, 'PROJECT-LICENSE'))
  await writeFile(
    join(staging, 'STAGING-README.txt'),
    [
      'These are release resource inputs, not a signed or distributable application.',
      'The project license is copied unchanged; an Apache-2.0 relicensing decision requires copyright authority review.',
      'Retain runtime source archives, licenses, notices, build configuration and manifest with distribution materials.',
      'An application packager must place runtime/ and speech-worker/ outside app.asar, preserve symlinks and executable permissions, and include Electron/Chromium notices.',
      'Final signing, notarization, clean-machine loading, third-party notices and LGPL replacement/relinking compliance remain release checks.',
      '',
    ].join('\n'),
  )
  await rename(staging, destination)
  execFileSync(
    process.execPath,
    [
      join(repository, 'scripts/runtime/CheckRuntime.mjs'),
      '--runtime-root',
      join(destination, 'runtime'),
    ],
    { stdio: 'inherit' },
  )
  console.log(`Release resource inputs staged at ${destination}`)
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
