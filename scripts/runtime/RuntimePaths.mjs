import { realpath } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path'

export function assertSafeRuntimeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`Unsafe runtime-relative path: ${String(value)}`)
  }
  if (isAbsolute(value) || win32.isAbsolute(value) || value.includes('\\')) {
    throw new Error(`Unsafe runtime-relative path: ${value}`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe runtime-relative path: ${value}`)
  }
  if (posix.normalize(value) !== value) {
    throw new Error(`Unsafe runtime-relative path: ${value}`)
  }
  return value
}

export function resolveRuntimePath(root, runtimeRelativePath) {
  assertSafeRuntimeRelativePath(runtimeRelativePath)
  const absoluteRoot = resolve(root)
  const candidate = resolve(absoluteRoot, runtimeRelativePath)
  const fromRoot = relative(absoluteRoot, candidate)
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe runtime-relative path: ${runtimeRelativePath}`)
  }
  return candidate
}

export async function assertNoSymlinkEscape(root, runtimeRelativePath) {
  const absoluteRoot = await realpath(root)
  const candidate = resolveRuntimePath(absoluteRoot, runtimeRelativePath)
  const resolvedCandidate = await realpath(candidate)
  const fromRoot = relative(absoluteRoot, resolvedCandidate)
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new Error(`Runtime path escapes root through a symlink: ${runtimeRelativePath}`)
  }
  return resolvedCandidate
}
