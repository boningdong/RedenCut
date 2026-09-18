import { assertSafeRuntimeRelativePath } from './RuntimePaths.mjs'

const platforms = new Set(['darwin', 'linux', 'win32'])
const architectures = new Set(['arm64', 'x64'])
const executableNames = new Set(['ffmpeg', 'ffprobe', 'whisper-cli', 'python', 'uv'])
const sha256Pattern = /^[a-f0-9]{64}$/
const runtimeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requireNonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a nonempty string`)
  }
}

export function validateRuntimeManifest(value) {
  const manifest = requireRecord(value, 'Runtime manifest')
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported runtime manifest schemaVersion: ${String(manifest.schemaVersion)}`)
  }
  if (typeof manifest.runtimeId !== 'string' || !runtimeIdPattern.test(manifest.runtimeId)) {
    throw new Error('runtimeId must be a nonempty identifier')
  }
  if (!platforms.has(manifest.platform)) {
    throw new Error(`Unsupported runtime platform: ${String(manifest.platform)}`)
  }
  if (!architectures.has(manifest.arch)) {
    throw new Error(`Unsupported runtime architecture: ${String(manifest.arch)}`)
  }

  const executables = requireRecord(manifest.executables, 'executables')
  for (const name of Object.keys(executables)) {
    if (!executableNames.has(name)) throw new Error(`Unknown executable key: ${name}`)
    assertSafeRuntimeRelativePath(executables[name])
  }
  for (const required of ['ffmpeg', 'ffprobe']) {
    if (!(required in executables)) throw new Error(`Missing required executable: ${required}`)
  }

  if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
    throw new Error('components must be a nonempty array')
  }
  for (const [index, component] of manifest.components.entries()) {
    requireRecord(component, `components[${index}]`)
    for (const key of ['name', 'version', 'license', 'sourceUrl']) {
      requireNonemptyString(component[key], `components[${index}].${key}`)
    }
    try {
      new URL(component.sourceUrl)
    } catch {
      throw new Error(`components[${index}].sourceUrl must be an absolute URL`)
    }
    if (component.sourceSha256 !== undefined && !sha256Pattern.test(component.sourceSha256)) {
      throw new Error(`components[${index}].sourceSha256 must be a lowercase SHA-256 digest`)
    }
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('files must be a nonempty array')
  }
  const filePaths = new Set()
  for (const [index, file] of manifest.files.entries()) {
    requireRecord(file, `files[${index}]`)
    assertSafeRuntimeRelativePath(file.path)
    if (!sha256Pattern.test(file.sha256)) {
      throw new Error(`files[${index}].sha256 must be a lowercase SHA-256 digest`)
    }
    if (filePaths.has(file.path)) throw new Error(`Duplicate runtime file path: ${file.path}`)
    filePaths.add(file.path)
  }

  return manifest
}
