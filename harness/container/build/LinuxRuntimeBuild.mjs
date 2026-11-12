import { execFile } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { downloadRuntimeSource } from '../../../scripts/runtime/DownloadRuntimeSource.mjs'

const execute = promisify(execFile)

export async function runBuildCommand(command, arguments_, options = {}) {
  const { stdout, stderr } = await execute(command, arguments_, {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

export function requireBuildDirectory(path, name) {
  if (!path) throw new Error(`${name} must be set for the Linux runtime build`)
  return path
}

export async function prepareRuntimeSource(source, workDirectory, runtimeRoot) {
  const archive = await downloadRuntimeSource(source, join(workDirectory, 'downloads'))
  const sourcesDirectory = join(workDirectory, 'sources')
  await mkdir(sourcesDirectory, { recursive: true })
  await runBuildCommand('tar', ['-xf', archive, '-C', sourcesDirectory])
  const archiveDirectory = join(runtimeRoot, 'sources')
  await mkdir(archiveDirectory, { recursive: true })
  await cp(archive, join(archiveDirectory, source.archive))
  return join(sourcesDirectory, source.sourceDirectory)
}
