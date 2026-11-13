import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gitOutput } from '../release/ReleaseState.mjs'
import { sha256File } from '../runtime/RuntimeIntegrity.mjs'

export const BUILD_RECORD_PATH = 'dist-electron/build-record.json'
const entrypoints = ['main/index.js', 'preload/index.js', 'renderer/index.html']

async function sourceIdentity(root, platform, arch) {
  if (platform !== 'darwin' || arch !== 'arm64')
    throw new Error('Application build artifact requires macOS arm64')
  if (gitOutput(root, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error('Build artifact requires a clean working tree')
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  return {
    commit: gitOutput(root, 'rev-parse', 'HEAD'),
    version,
    packageLockSha256: await sha256File(join(root, 'package-lock.json')),
    platform,
    arch,
  }
}

async function inventory(directory, prefix = '') {
  if (!(await lstat(directory)).isDirectory())
    throw new Error(`Build directory must be a real directory: ${directory}`)
  const files = []
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name)
    const relative = prefix ? `${prefix}/${name}` : name
    const info = await lstat(path)
    if (info.isDirectory()) files.push(...(await inventory(path, relative)))
    else if (info.isFile()) files.push({ path: relative, sha256: await sha256File(path) })
    else throw new Error(`Unsupported build artifact entry: ${relative}`)
  }
  return files
}

async function compiledFiles(root) {
  const files = await inventory(join(root, 'out'))
  for (const entry of entrypoints) {
    if (
      !files.some((file) => file.path === entry) ||
      (await lstat(join(root, 'out', entry))).size === 0
    )
      throw new Error(`Missing or empty build entrypoint: ${entry}`)
  }
  return files
}

export async function writeBuildRecord({
  root = resolve(import.meta.dirname, '../..'),
  recordPath = BUILD_RECORD_PATH,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const identity = await sourceIdentity(root, platform, arch)
  const record = { schemaVersion: 1, ...identity, files: await compiledFiles(root) }
  if (JSON.stringify(identity) !== JSON.stringify(await sourceIdentity(root, platform, arch)))
    throw new Error('Source changed while recording build')
  const destination = resolve(root, recordPath)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, `${JSON.stringify(record, null, 2)}\n`)
  return record
}

export async function verifyBuildRecord({
  root = resolve(import.meta.dirname, '../..'),
  recordPath = BUILD_RECORD_PATH,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const record = JSON.parse(await readFile(resolve(root, recordPath), 'utf8'))
  const identity = await sourceIdentity(root, platform, arch)
  if (record.schemaVersion !== 1) throw new Error('Unsupported build record version')
  for (const [key, value] of Object.entries(identity)) {
    if (record[key] !== value)
      throw new Error(`Build record ${key} does not match packaging checkout`)
  }
  if (JSON.stringify(record.files) !== JSON.stringify(await compiledFiles(root)))
    throw new Error('Compiled build file inventory or checksums do not match build record')
  return record
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [action, ...extra] = process.argv.slice(2)
  if (extra.length || !['write', 'verify'].includes(action))
    throw new Error('Usage: node scripts/ci/BuildArtifact.mjs {write|verify}')
  if (action === 'write') await writeBuildRecord()
  else await verifyBuildRecord()
}
