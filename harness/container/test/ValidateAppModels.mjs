import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [directory, manifestPath] = process.argv.slice(2)
if (!directory || !manifestPath) {
  console.error('Usage: ValidateAppModels.mjs APP_MODELS_DIRECTORY MODEL_MANIFEST')
  process.exit(64)
}

async function verifyFile(path, expected) {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size !== expected.size) return false
  const algorithm = expected.sha256 ? 'sha256' : 'sha1'
  const digest = expected.sha256 ?? expected.gitBlobSha1
  if (!digest) return false
  const hash = createHash(algorithm)
  if (algorithm === 'sha1') hash.update(`blob ${stat.size}\0`)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === digest
}

async function validate() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const required = manifest.models.filter(
    (model) =>
      (model.capability === 'transcription' && model.selection?.recommended !== false) ||
      model.capability === 'alignment',
  )
  if (required.length === 0) throw new Error('manifest contains no app speech models')
  for (const model of required) {
    const installed = join(directory, model.capability, model.id, model.revision)
    const record = JSON.parse(readFileSync(join(installed, 'installation.json'), 'utf8'))
    if (['id', 'repository', 'revision'].some((key) => record[key] !== model[key]))
      throw new Error(`${model.id} marker does not match the manifest`)
    if (!Array.isArray(model.files) || !Array.isArray(record.files))
      throw new Error(`${model.id} has no file inventory`)
    for (const file of model.files) {
      const stored = record.files.find((item) => item.path === file.path)
      if (!stored || stored.size !== file.size)
        throw new Error(`${model.id}/${file.path} marker is invalid`)
      const expected =
        file.requiresAuthenticatedSha256 && /^[a-f0-9]{64}$/.test(stored.sha256)
          ? { ...file, sha256: stored.sha256 }
          : file
      if (!(await verifyFile(join(installed, file.path), expected)))
        throw new Error(`${model.id}/${file.path} is missing or has a wrong digest`)
    }
  }
}

try {
  await validate()
} catch (error) {
  console.error(`MODEL_FIXTURE_INVALID: ${error.message}`)
  process.exitCode = 1
}
