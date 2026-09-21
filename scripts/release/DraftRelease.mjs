#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitOutput, readReleaseState, verifyReleaseArtifact } from './ReleaseState.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run'))
  throw new Error('Usage: npm run release:draft -- [--dry-run]')
const state = await readReleaseState(root)
const directory = join(root, 'dist-electron/releases', state.tag)
const record = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'))
const artifact = join(directory, state.filename)
await verifyReleaseArtifact(state, record, artifact)
const checksums = join(directory, 'SHA256SUMS.txt')
if ((await readFile(checksums, 'utf8')) !== `${record.sha256}  ${state.filename}\n`)
  throw new Error('Checksum file does not match the prepared artifact.')
const notes = join(directory, 'release-notes.md')
if (!(await readFile(notes, 'utf8')).trim()) throw new Error('Release notes cannot be empty.')
const origin = gitOutput(root, 'remote', 'get-url', 'origin')
const match = /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
  origin,
)
if (!match) throw new Error('origin must identify a GitHub repository via HTTPS or SSH.')
const repository = match[1]
const command = [
  'release',
  'create',
  state.tag,
  artifact,
  checksums,
  join(directory, 'release.json'),
  '--repo',
  repository,
  '--verify-tag',
  '--draft',
  '--title',
  `RedenCut ${state.version}`,
  '--notes-file',
  notes,
  ...(state.prerelease ? ['--prerelease', '--latest=false'] : []),
]
if (args.includes('--dry-run')) {
  console.log(
    JSON.stringify(
      {
        repository,
        ...state,
        command: ['gh', ...command],
        note: 'Local validation only. Upload additionally checks gh authentication and the remote tag commit.',
      },
      null,
      2,
    ),
  )
} else {
  execFileSync('gh', ['auth', 'status', '--hostname', 'github.com'], {
    cwd: root,
    stdio: 'inherit',
  })
  const tag = gitOutput(root, 'rev-parse', '--verify', `refs/tags/${state.tag}^{commit}`)
  if (tag !== state.commit) throw new Error('Local version tag must point to the prepared commit.')
  function api(endpoint, ...options) {
    return JSON.parse(
      execFileSync('gh', ['api', endpoint, ...options], { cwd: root, encoding: 'utf8' }),
    )
  }
  let object = api(`repos/${repository}/git/ref/tags/${encodeURIComponent(state.tag)}`).object
  for (let depth = 0; object.type === 'tag' && depth < 5; depth += 1)
    object = api(`repos/${repository}/git/tags/${object.sha}`).object
  if (object.type !== 'commit' || object.sha !== state.commit)
    throw new Error('Remote version tag must point to the prepared commit.')
  const releases = api(`repos/${repository}/releases?per_page=100`, '--paginate', '--slurp').flat()
  const existing = releases.find((release) => release.tag_name === state.tag)
  if (existing) {
    if (!existing.draft) throw new Error('This version is already published; use a new version.')
    // Workflow concurrency serializes retries for this tag. Only drafts may be replaced.
    execFileSync(
      'gh',
      [
        'release',
        'upload',
        state.tag,
        artifact,
        checksums,
        join(directory, 'release.json'),
        '--repo',
        repository,
        '--clobber',
      ],
      { cwd: root, stdio: 'inherit' },
    )
    console.log(`Refreshed draft assets (existing notes preserved): ${existing.html_url}`)
  } else {
    execFileSync('gh', command, { cwd: root, stdio: 'inherit' })
  }
}
