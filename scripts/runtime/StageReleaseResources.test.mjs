import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  stageManagedModelResources,
  validateDiarizationNotices,
} from '../StageReleaseResources.mjs'

async function writeNotices(root, model, modelCard = 'upstream model card\n') {
  const notices = join(root, 'speech-worker/licenses/diarization')
  await mkdir(notices, { recursive: true })
  await writeFile(
    join(notices, 'LICENSE-NOTICE.txt'),
    'Creative Commons Attribution 4.0 International CC-BY-4.0. Attribution and citations: Author Example.',
  )
  await writeFile(
    join(notices, 'SOURCE.txt'),
    `Model: ${model.repository}\nSource: https://huggingface.co/${model.repository}\nRevision: ${model.revision}\nLicense: CC-BY-4.0\n`,
  )
  await writeFile(
    join(notices, 'CHANGE-NOTICE.txt'),
    'RedenCut redistributes the upstream files without modifying their contents and adds packaging files.',
  )
  await writeFile(join(notices, 'UPSTREAM-README.md'), modelCard)
  const blob = createHash('sha1')
    .update(`blob ${Buffer.byteLength(modelCard)}\0`)
    .update(modelCard)
    .digest('hex')
  await writeFile(
    join(notices, 'UPSTREAM-METADATA.json'),
    JSON.stringify({
      source: `https://huggingface.co/api/models/${model.repository}/revision/${model.revision}?blobs=true`,
      repository: model.repository,
      revision: model.revision,
      modelCard: { path: 'README.md', size: Buffer.byteLength(modelCard), gitBlobSha1: blob },
      files: model.files,
    }),
  )
  return notices
}

test('release staging fails when the required managed model is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-test-'))
  await assert.rejects(
    stageManagedModelResources({
      repository: process.cwd(),
      staging: join(root, 'staging'),
      modelsRoot: root,
    }),
    /required managed diarization model/i,
  )
})

test('release staging rejects an installation with corrupt allowlisted model content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-test-'))
  const revision = 'revision'
  const modelRoot = join(root, '.runtime/models/diarization', revision)
  await mkdir(modelRoot, { recursive: true })
  await writeFile(
    join(root, 'speech-worker-models.json'),
    JSON.stringify({
      models: [
        {
          id: 'diarization-default',
          capability: 'diarization',
          repository: 'example/model',
          revision,
          files: [{ path: 'config.yaml', size: 1, sha256: '0'.repeat(64) }],
        },
      ],
    }),
  )
  await writeFile(join(modelRoot, 'installation.json'), '{}')
  await assert.rejects(
    stageManagedModelResources({
      repository: root,
      staging: join(root, 'staging'),
      manifestPath: join(root, 'speech-worker-models.json'),
      modelsRoot: join(root, '.runtime/models'),
    }),
    /managed diarization|installation/i,
  )
})

test('release staging copies only verified allowlisted model files and notices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-test-'))
  const revision = 'revision'
  const contents = 'model'
  const file = {
    path: 'weights/model.bin',
    size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
  const model = {
    id: 'diarization-default',
    capability: 'diarization',
    repository: 'example/model',
    revision,
    files: [file],
  }
  const modelRoot = join(root, '.runtime/models/diarization', revision)
  await mkdir(dirname(join(modelRoot, file.path)), { recursive: true })
  await writeFile(join(modelRoot, file.path), contents)
  await writeFile(
    join(modelRoot, 'installation.json'),
    JSON.stringify({ id: model.id, repository: model.repository, revision, files: [file] }),
  )
  await writeNotices(root, model)
  const manifestPath = join(root, 'models.json')
  await writeFile(manifestPath, JSON.stringify({ models: [model] }))
  const staging = join(root, 'staging')
  await stageManagedModelResources({
    repository: root,
    staging,
    manifestPath,
    modelsRoot: join(root, '.runtime/models'),
  })
  assert.equal(
    await readFile(join(staging, 'models/diarization', revision, file.path), 'utf8'),
    contents,
  )
  assert.deepEqual((await readdir(join(staging, 'models/diarization', revision))).sort(), [
    'installation.json',
    'weights',
  ])
  assert.equal(
    await readFile(
      join(
        staging,
        'third-party-notices/pyannote-speaker-diarization-community-1/LICENSE-NOTICE.txt',
      ),
      'utf8',
    ),
    'Creative Commons Attribution 4.0 International CC-BY-4.0. Attribution and citations: Author Example.',
  )
})

test('release staging refuses missing or tampered model notice materials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-notices-'))
  const revision = 'revision'
  const contents = 'model'
  const file = {
    path: 'weights/model.bin',
    size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
  const model = {
    id: 'diarization-default',
    capability: 'diarization',
    repository: 'example/model',
    revision,
    files: [file],
  }
  const modelRoot = join(root, '.runtime/models/diarization', revision)
  await mkdir(dirname(join(modelRoot, file.path)), { recursive: true })
  await writeFile(join(modelRoot, file.path), contents)
  await writeFile(
    join(modelRoot, 'installation.json'),
    JSON.stringify({ id: model.id, repository: model.repository, revision, files: [file] }),
  )
  const manifestPath = join(root, 'models.json')
  await writeFile(manifestPath, JSON.stringify({ models: [model] }))
  const notices = await writeNotices(root, model)
  await rm(join(notices, 'SOURCE.txt'))
  await assert.rejects(
    stageManagedModelResources({
      repository: root,
      staging: join(root, 'missing-staging'),
      manifestPath,
      modelsRoot: join(root, '.runtime/models'),
    }),
    /notice.*SOURCE|SOURCE.*notice/i,
  )
  await writeNotices(root, model)
  await writeFile(join(notices, 'UPSTREAM-README.md'), 'tampered')
  await assert.rejects(
    stageManagedModelResources({
      repository: root,
      staging: join(root, 'tampered-staging'),
      manifestPath,
      modelsRoot: join(root, '.runtime/models'),
    }),
    /model card.*(size|hash)|upstream.*README/i,
  )
})

test('release staging refuses extraneous files in model notice materials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-secret-'))
  const model = {
    id: 'diarization-default',
    capability: 'diarization',
    repository: 'example/model',
    revision: 'revision',
    files: [{ path: 'model.bin', size: 1, sha256: '0'.repeat(64) }],
  }
  const notices = await writeNotices(root, model)
  await writeFile(join(notices, 'token'), 'hf_secret')
  await assert.rejects(
    validateDiarizationNotices(notices, model),
    /unexpected.*notice|notice.*token/i,
  )
})
