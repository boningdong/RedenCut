import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { assertSafeRuntimeRelativePath } from '../runtime/RuntimePaths.mjs'

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function validateManagedDiarization(directory, model) {
  const record = JSON.parse(await readFile(join(directory, 'installation.json'), 'utf8'))
  for (const key of ['id', 'repository', 'revision']) {
    if (record[key] !== model[key])
      throw new Error(`Managed diarization installation has wrong ${key}`)
  }
  if (JSON.stringify(record.files) !== JSON.stringify(model.files)) {
    throw new Error('Managed diarization installation has an unexpected file manifest')
  }
  await validateModelFiles(directory, model)
  const allowed = new Set(['installation.json', ...model.files.map(({ path }) => path)])
  async function inspect(current, relative = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await inspect(join(current, entry.name), child)
      else if (!allowed.has(child)) throw new Error(`Unexpected managed model asset: ${child}`)
    }
  }
  await inspect(directory)
  return record
}

async function validateModelFiles(directory, model) {
  for (const file of model.files) {
    assertSafeRuntimeRelativePath(file.path)
    const path = join(directory, file.path)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Managed model file is not regular: ${file.path}`)
    if (stat.size !== file.size) throw new Error(`Managed model file size mismatch: ${file.path}`)
    if ((await sha256(path)) !== file.sha256)
      throw new Error(`Managed model SHA-256 mismatch: ${file.path}`)
  }
}
