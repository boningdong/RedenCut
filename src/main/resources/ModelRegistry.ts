import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { ModelDefinition, ModelFile } from '../../shared/modelManifest.schema'
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
  constructor(readonly root: string) {}
  async resolve(model: ModelDefinition): Promise<string | null> {
    const { installed } = resourcePaths(this.root, model)
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
    const { staging, installed } = resourcePaths(this.root, model)
    const files: ModelFile[] = []
    for (const file of model.files) {
      const expected = await stagedModelFile(join(staging, file.path), file)
      if (!(await verifyModelFile(join(staging, file.path), expected)))
        throw new Error('integrity-failed')
      files.push(expected)
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
    await rm(installed, { recursive: true, force: true })
    await rename(staging, installed)
    return installed
  }
}
