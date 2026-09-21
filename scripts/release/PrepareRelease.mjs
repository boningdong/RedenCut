#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactDigest, readReleaseState } from './ReleaseState.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.argv.length > 2) throw new Error('Usage: npm run release:prepare')
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Release preparation currently requires macOS arm64.')
const initial = await readReleaseState(root)
const destination = join(root, 'dist-electron', 'releases', initial.tag)
await mkdir(destination, { recursive: true })
// A failed new build must never leave an older record eligible for upload.
await rm(join(destination, 'release.json'), { force: true })
function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}
run('npm', ['run', 'runtime:check'])
run('npm', ['run', 'check'])
run('npm', ['run', 'test:runtime'])
run('npm', ['run', 'test:release'])
run('npm', ['run', 'package:mac'])
const packaged = join(root, 'dist-electron/package')
run('codesign', ['--verify', '--deep', '--strict', join(packaged, 'mac-arm64/RedenCut.app')])
run('hdiutil', ['verify', join(packaged, initial.filename)])
const final = await readReleaseState(root)
if (JSON.stringify(final) !== JSON.stringify(initial))
  throw new Error('Source changed during release preparation; rebuild from a stable checkout.')
const artifact = join(destination, initial.filename)
await copyFile(join(packaged, initial.filename), artifact)
const digest = await artifactDigest(artifact)
await writeFile(join(destination, 'SHA256SUMS.txt'), `${digest.sha256}  ${initial.filename}\n`)
const notes = join(destination, 'release-notes.md')
// Preserve release notes edited by the maintainer when retrying the same version.
try {
  await writeFile(
    notes,
    [
      `# RedenCut ${initial.version}`,
      '',
      'macOS Apple Silicon (arm64) build. Intel Macs and Windows are not supported by this package.',
      'Ad-hoc signed, not Apple-notarized. macOS may block the first launch; see https://support.apple.com/102445.',
      'Manual installation and upgrades only; automatic updates are not included.',
      'Whisper and alignment models are downloaded through the app; the speaker-recognition model is bundled.',
      '',
      `Source commit: ${initial.commit}`,
      '',
      '## Changes',
      '',
      'Review and describe the user-facing changes before publishing this draft.',
      '',
    ].join('\n'),
    { flag: 'wx' },
  )
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
const runtime = JSON.parse(
  await readFile(
    join(packaged, 'mac-arm64/RedenCut.app/Contents/Resources/runtime/manifest.json'),
    'utf8',
  ),
)
await writeFile(
  join(destination, 'release.json'),
  `${JSON.stringify(
    {
      ...initial,
      ...digest,
      runtimeId: runtime.runtimeId,
      preparedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)
console.log(
  `Prepared ${initial.tag} at ${destination}. Test this DMG and edit release-notes.md before uploading.`,
)
