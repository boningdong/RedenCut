import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { sha256File } from './RuntimeIntegrity.mjs'

const defaultLockPath = fileURLToPath(new URL('../../runtime/runtime-lock.json', import.meta.url))

/** Overrides replace a complete artifact record so URL, hash and version stay together. */
export function resolveRuntimeLock(lock, platform) {
  const overrides = lock.platformOverrides?.[platform] ?? {}
  return {
    ...lock,
    sources: { ...lock.sources, ...overrides.sources },
    buildTools: { ...lock.buildTools, ...overrides.buildTools },
    data: { ...lock.data, ...overrides.data },
  }
}

export async function readRuntimeLock({
  platform = process.platform,
  lockPath = defaultLockPath,
} = {}) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  return resolveRuntimeLock(lock, platform)
}

export function assertLockedPythonDependencyHashes(expected, actual) {
  if (
    actual.pyprojectSha256 !== expected.pyprojectSha256 ||
    actual.uvLockSha256 !== expected.uvLockSha256
  ) {
    throw new Error('speech-worker dependency files do not match runtime-lock.json')
  }
}

export async function verifyPythonDependencyInputs(lock, workerRoot) {
  const actual = {
    pyprojectSha256: await sha256File(join(workerRoot, 'pyproject.toml')),
    uvLockSha256: await sha256File(join(workerRoot, 'uv.lock')),
  }
  assertLockedPythonDependencyHashes(lock.pythonDependencies, actual)
  return actual
}
