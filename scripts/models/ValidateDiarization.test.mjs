import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { validateManagedDiarization } from './ValidateDiarization.mjs'

const contents = 'weights'
const model = {
  id: 'diarization-default',
  capability: 'diarization',
  repository: 'example/model',
  revision: 'revision',
  files: [
    {
      path: 'weights/model.bin',
      size: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
    },
  ],
}

async function installation(context) {
  const directory = await mkdtemp(join(tmpdir(), 'redencut-model-validation-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(dirname(join(directory, model.files[0].path)), { recursive: true })
  await writeFile(join(directory, model.files[0].path), contents)
  const record = {
    id: model.id,
    repository: model.repository,
    revision: model.revision,
    files: model.files,
  }
  await writeFile(join(directory, 'installation.json'), JSON.stringify(record))
  return { directory, record }
}

test('validates the pinned installation record and model hashes', async (context) => {
  const { directory, record } = await installation(context)
  assert.deepEqual(await validateManagedDiarization(directory, model), record)
})

test('rejects mismatched revisions, file manifests, and content', async (context) => {
  const { directory, record } = await installation(context)
  await writeFile(
    join(directory, 'installation.json'),
    JSON.stringify({ ...record, revision: 'wrong' }),
  )
  await assert.rejects(validateManagedDiarization(directory, model), /wrong revision/)
  await writeFile(join(directory, 'installation.json'), JSON.stringify({ ...record, files: [] }))
  await assert.rejects(validateManagedDiarization(directory, model), /unexpected file manifest/)
  await writeFile(join(directory, 'installation.json'), JSON.stringify(record))
  await writeFile(join(directory, model.files[0].path), 'corrupt')
  await assert.rejects(validateManagedDiarization(directory, model), /SHA-256 mismatch/)
  await writeFile(join(directory, model.files[0].path), 'long corrupt')
  await assert.rejects(validateManagedDiarization(directory, model), /size mismatch/)
})

test('rejects unexpected credential assets and symbolic model files', async (context) => {
  const { directory } = await installation(context)
  await writeFile(join(directory, 'token'), 'test-secret')
  await assert.rejects(validateManagedDiarization(directory, model), /Unexpected.*token/)
  await rm(join(directory, 'token'))
  await rm(join(directory, model.files[0].path))
  await symlink(join(directory, 'installation.json'), join(directory, model.files[0].path))
  await assert.rejects(validateManagedDiarization(directory, model), /not regular/)
})
