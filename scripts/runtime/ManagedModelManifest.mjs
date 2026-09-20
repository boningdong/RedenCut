import { readFile } from 'node:fs/promises'

import { assertSafeRuntimeRelativePath } from './RuntimePaths.mjs'

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

export function validateDiarizationModel(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model))
    throw new Error('Diarization model must be an object')
  if (!identifierPattern.test(model.id ?? '')) throw new Error('Diarization model id is invalid')
  if (!repositoryPattern.test(model.repository ?? ''))
    throw new Error('Diarization model repository is invalid')
  if (!identifierPattern.test(model.revision ?? ''))
    throw new Error('Diarization model revision is invalid')
  if (!Array.isArray(model.files) || model.files.length === 0)
    throw new Error('Diarization model file manifest must not be empty')
  const paths = new Set()
  for (const file of model.files) {
    assertSafeRuntimeRelativePath(file.path)
    if (paths.has(file.path)) throw new Error(`Duplicate diarization model file: ${file.path}`)
    paths.add(file.path)
    if (!Number.isSafeInteger(file.size) || file.size <= 0)
      throw new Error(`Diarization file has invalid size: ${file.path}`)
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? ''))
      throw new Error(`Diarization file lacks a pinned SHA-256: ${file.path}`)
  }
  return model
}

export async function loadDiarizationModel(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const model = manifest.models?.find((candidate) => candidate.capability === 'diarization')
  if (!model) throw new Error('Model manifest does not define a diarization model')
  return validateDiarizationModel(model)
}
