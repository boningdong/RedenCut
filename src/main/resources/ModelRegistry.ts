import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { ModelDefinition, ModelFile } from '../../shared/modelManifest.schema'
import type { ManagedModelLocation } from './ManagedModelLocation'
import { resourcePaths } from './resourcePaths'
export async function verifyModelFile(path: string, file: ModelFile): Promise<boolean> {
  try {
    if (!file.sha256 && !file.gitBlobSha1) return false
    const s = await stat(path)
    if (!s.isFile() || s.size !== file.size) return false
    const hash = createHash(file.sha256 ? 'sha256' : 'sha1')
    if (!file.sha256) hash.update(`blob ${file.size}\0`)
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex') === (file.sha256 ?? file.gitBlobSha1)
  } catch {
    return false
  }
}
export async function stagedModelFile(path: string, file: ModelFile): Promise<ModelFile> {
  if (!file.requiresAuthenticatedSha256) return file
  try {
    const record = JSON.parse(await readFile(path + '.integrity.json', 'utf8'))
    if (/^[a-f0-9]{64}$/.test(record.sha256)) return { ...file, sha256: record.sha256 }
  } catch {
    /* Missing authenticated metadata is never a usable installation. */
  }
  return file
}
export class ModelRegistry {
  constructor(
    readonly root: string,
    readonly managed?: ManagedModelLocation,
    readonly modelsRoot = join(root, 'models'),
  ) {}
  managedPath(model: ModelDefinition): string | undefined {
    return this.managed && model.capability === 'diarization'
      ? join(this.managed.root, 'diarization', model.id, model.revision)
      : undefined
  }
  paths(model: ModelDefinition) {
    return resourcePaths(this.root, model, this.modelsRoot)
  }
  async resolve(model: ModelDefinition): Promise<string | null> {
    const installed = this.managedPath(model) ?? this.paths(model).installed
    try {
      const record = JSON.parse(await readFile(join(installed, 'installation.json'), 'utf8'))
      if (
        record.id !== model.id ||
        record.repository !== model.repository ||
        record.revision !== model.revision
      )
        return null
      for (const file of model.files) {
        const stored = Array.isArray(record.files)
          ? record.files.find((entry: ModelFile) => entry.path === file.path)
          : undefined
        if (!stored || stored.size !== file.size) return null
        const expected =
          file.requiresAuthenticatedSha256 && /^[a-f0-9]{64}$/.test(stored.sha256)
            ? { ...file, sha256: stored.sha256 }
            : file
        if (!(await verifyModelFile(join(installed, file.path), expected))) return null
      }
      return installed
    } catch {
      return null
    }
  }
  async publish(model: ModelDefinition): Promise<string> {
    if (this.managedPath(model)) throw new Error('managed-model-required')
    const { staging, installed } = this.paths(model)
    const files: ModelFile[] = []
    for (const file of model.files) {
      const expected = await stagedModelFile(join(staging, file.path), file)
      if (!(await verifyModelFile(join(staging, file.path), expected)))
        throw new Error('integrity-failed')
      files.push(expected)
      await rm(join(staging, file.path) + '.download.json', { force: true })
      await rm(join(staging, file.path) + '.integrity.json', { force: true })
    }
    await writeFile(
      join(staging, 'installation.json'),
      JSON.stringify({
        id: model.id,
        repository: model.repository,
        revision: model.revision,
        files,
      }),
    )
    await mkdir(dirname(installed), { recursive: true })
    const displaced = installed + '.previous-' + randomUUID()
    let movedPrevious = false
    try {
      await rename(installed, displaced)
      movedPrevious = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(staging, installed)
    } catch (error) {
      if (movedPrevious) await rename(displaced, installed)
      throw error
    }
    if (movedPrevious) await rm(displaced, { recursive: true, force: true })
    return installed
  }
}
