import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative } from 'node:path'
import { RuntimeManifestSchema } from '../../shared/RuntimeManifest'
import type { RuntimeManifest, RuntimeExecutable } from '../../shared/RuntimeManifest'

type RuntimeFailure =
  | 'missing'
  | 'invalid-manifest'
  | 'wrong-architecture'
  | 'invalid-path'
  | 'integrity-failed'
  | 'not-executable'

export class RuntimeValidationError extends Error {
  constructor(
    readonly component: RuntimeExecutable,
    readonly reason: RuntimeFailure,
  ) {
    super(`runtime-unavailable:${component}:${reason}`)
  }
}

/** Resolves only inventoried files contained in one selected runtime generation. */
export class RuntimeValidator {
  private manifest?: RuntimeManifest
  private manifestIdentity?: string
  private readonly verified = new Map<string, string>()
  constructor(private readonly root: string) {}

  private readManifest(component: RuntimeExecutable): RuntimeManifest {
    let raw: string
    let identity: string
    try {
      const path = join(this.root, 'manifest.json')
      const stat = statSync(path)
      identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
      if (this.manifest && this.manifestIdentity === identity) return this.manifest
      raw = readFileSync(path, 'utf8')
    } catch {
      throw new RuntimeValidationError(component, 'missing')
    }
    let manifest: RuntimeManifest
    try {
      manifest = RuntimeManifestSchema.parse(JSON.parse(raw))
    } catch {
      throw new RuntimeValidationError(component, 'invalid-manifest')
    }
    if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
      throw new RuntimeValidationError(component, 'wrong-architecture')
    }
    this.manifest = manifest
    this.manifestIdentity = identity
    this.verified.clear()
    return manifest
  }

  resolve(component: RuntimeExecutable): string {
    const manifest = this.readManifest(component)
    const entry = manifest.executables[component]
    if (!entry) throw new RuntimeValidationError(component, 'missing')
    const path = join(this.root, entry)
    let resolved: string
    try {
      resolved = realpathSync(path)
    } catch {
      throw new RuntimeValidationError(component, 'missing')
    }
    const contained = relative(realpathSync(this.root), resolved)
    if (
      contained === '..' ||
      contained.startsWith('../') ||
      contained.startsWith('..\\') ||
      isAbsolute(contained)
    ) {
      throw new RuntimeValidationError(component, 'invalid-path')
    }
    const stat = statSync(resolved)
    if (!stat.isFile()) throw new RuntimeValidationError(component, 'not-executable')
    try {
      accessSync(resolved, constants.X_OK)
    } catch {
      throw new RuntimeValidationError(component, 'not-executable')
    }
    const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    if (this.verified.get(path) !== identity) {
      const expected = manifest.files.find((file) => file.path === entry)!.sha256
      const actual = createHash('sha256').update(readFileSync(resolved)).digest('hex')
      if (actual !== expected) throw new RuntimeValidationError(component, 'integrity-failed')
      this.verified.set(path, identity)
    }
    return path
  }
}
