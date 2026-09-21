#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { stageReleaseResources } from './StageReleaseResources.mjs'
import { checkRuntime } from './runtime/CheckRuntime.mjs'

const require = createRequire(import.meta.url)
const { build, Platform } = require('electron-builder')
const configuration = require('../electron-builder.config.cjs')
const repository = dirname(dirname(fileURLToPath(import.meta.url)))
const arguments_ = process.argv.slice(2)
if (arguments_.some((argument) => argument !== '--dir'))
  throw new Error('Usage: npm run package:mac -- [--dir]')
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('The managed release runtime currently supports macOS arm64 only.')

// Keep generated resources and downloader caches inside the ignored build tree.
const buildRoot = join(repository, '.runtime')
await mkdir(buildRoot, { recursive: true })
process.env.ELECTRON_BUILDER_CACHE ??= join(buildRoot, 'electron-builder-cache')
process.env.ELECTRON_CACHE ??= join(buildRoot, 'electron-cache')
const temporary = await mkdtemp(join(buildRoot, 'package-'))
const resources = join(temporary, 'resources')
try {
  execFileSync(
    process.execPath,
    [join(repository, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'],
    {
      cwd: repository,
      stdio: 'inherit',
    },
  )
  await stageReleaseResources(['--resources-dir', resources])
  await build({
    projectDir: repository,
    targets: Platform.MAC.createTarget(arguments_.includes('--dir') ? 'dir' : 'dmg'),
    publish: 'never',
    config: {
      ...configuration,
      extraResources: [{ from: resources, to: '.', filter: ['**/*'] }],
    },
  })
  const packagedRuntime = join(
    repository,
    configuration.directories.output,
    'mac-arm64/RedenCut.app/Contents/Resources/runtime',
  )
  const result = await checkRuntime(packagedRuntime)
  if (result.status !== 'ready') throw new Error(`Packaged runtime: ${result.message}`)
  console.log(`Packaged runtime verified: ${result.runtimeId}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
