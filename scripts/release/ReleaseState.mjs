import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export function gitOutput(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

export async function readReleaseState(root) {
  if (gitOutput(root, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error('Release requires a clean working tree; commit or move pending changes first.')
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version))
    throw new Error(
      'Unsupported release version; use major.minor.patch with an optional prerelease.',
    )
  if (lock.version !== version || lock.packages?.['']?.version !== version)
    throw new Error('The package version and lockfile versions must match.')
  return {
    version,
    tag: `v${version}`,
    prerelease: version.includes('-'),
    commit: gitOutput(root, 'rev-parse', 'HEAD'),
    filename: `RedenCut-${version}-arm64.dmg`,
  }
}

export async function artifactDigest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return { sha256: hash.digest('hex'), size: (await stat(path)).size }
}

export function assertReleaseTag(state, tag, commit) {
  if (tag !== state.tag) throw new Error(`Release tag must match ${state.tag}.`)
  if (commit !== state.commit) throw new Error('Release commit must match the checked-out source.')
}

export async function verifyReleaseArtifact(state, record, artifact) {
  for (const key of ['version', 'tag', 'commit', 'filename', 'prerelease']) {
    if (state[key] !== record[key]) throw new Error(`Prepared release ${key} no longer matches.`)
  }
  const actual = await artifactDigest(artifact)
  if (actual.sha256 !== record.sha256 || actual.size !== record.size)
    throw new Error('Prepared artifact checksum no longer matches; prepare the release again.')
}
