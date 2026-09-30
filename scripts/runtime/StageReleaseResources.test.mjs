import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { require as tsRequire } from 'tsx/cjs/api'

import {
  stageManagedModelResources,
  parseArguments,
  validateDiarizationNotices,
} from '../StageReleaseResources.mjs'

const { ModelInstaller } = tsRequire('../../src/main/resources/ModelInstaller.ts', import.meta.url)
const { ModelRegistry } = tsRequire('../../src/main/resources/ModelRegistry.ts', import.meta.url)

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
      modelsPath: root,
    }),
    /required managed diarization model/i,
  )
})

test('release staging rejects an installation with corrupt allowlisted model content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-release-test-'))
  const model = {
    id: 'diarization-default',
    capability: 'diarization',
    repository: 'example/model',
    revision: 'revision',
    files: [{ path: 'config.yaml', size: 1, sha256: '0'.repeat(64) }],
  }
  const modelRoot = join(root, 'shared-models/diarization/diarization-default', model.revision)
  await mkdir(modelRoot, { recursive: true })
  const manifestPath = join(root, 'models.json')
  await writeFile(manifestPath, JSON.stringify({ models: [model] }))
  await writeFile(join(modelRoot, 'config.yaml'), 'x')
  await writeFile(
    join(modelRoot, 'installation.json'),
    JSON.stringify({
      id: model.id,
      repository: model.repository,
      revision: model.revision,
      files: model.files,
    }),
  )
  await assert.rejects(
    stageManagedModelResources({
      repository: root,
      staging: join(root, 'staging'),
      manifestPath,
      modelsPath: join(root, 'shared-models'),
    }),
    /SHA-256 mismatch/,
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
  const modelRoot = join(root, 'shared-models/diarization/diarization-default', revision)
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
    modelsPath: join(root, 'shared-models'),
  })
  assert.equal(
    await readFile(
      join(staging, 'models/diarization/diarization-default', revision, file.path),
      'utf8',
    ),
    contents,
  )
  const environmentStaging = join(root, 'environment-staging')
  await stageManagedModelResources({
    repository: root,
    staging: environmentStaging,
    manifestPath,
    environment: { REDENCUT_MODELS_PATH: join(root, 'shared-models') },
  })
  assert.equal(
    await readFile(
      join(environmentStaging, 'models/diarization/diarization-default', revision, file.path),
      'utf8',
    ),
    contents,
  )
  const explicitStaging = join(root, 'explicit-staging')
  await stageManagedModelResources({
    repository: root,
    staging: explicitStaging,
    manifestPath,
    modelsPath: join(root, 'shared-models'),
    environment: { REDENCUT_MODELS_PATH: join(root, 'absent-models') },
  })

  assert.deepEqual(
    (await readdir(join(staging, 'models/diarization/diarization-default', revision))).sort(),
    ['installation.json', 'weights'],
  )
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
  const modelRoot = join(root, 'shared-models/diarization/diarization-default', revision)
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
      modelsPath: join(root, 'shared-models'),
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
      modelsPath: join(root, 'shared-models'),
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

test('release staging accepts a shared model path and rejects missing path values', () => {
  assert.deepEqual(parseArguments(['--resources-dir', '/release', '--models-path', '/shared']), {
    '--resources-dir': '/release',
    '--models-path': '/shared',
  })
  for (const args of [
    ['--resources-dir', '/release', '--models-path'],
    ['--resources-dir', '/release', '--models-path', '--bundle'],
    ['--resources-dir', '/release', '--models-root', '/old'],
  ])
    assert.throws(() => parseArguments(args), /Usage/)
})

test('shared installation stages from a custom environment directory with spaces', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-install-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const contents = Buffer.from('small offline model')
  const model = {
    id: 'diarization-default',
    capability: 'diarization',
    repository: 'example/model',
    revision: 'a'.repeat(40),
    expectedFiles: ['weights.bin'],
    license: 'CC-BY-4.0',
    access: 'gated-auto',
    profiles: [],
    supportedLanguages: ['en'],
    files: [
      {
        path: 'weights.bin',
        size: contents.length,
        sha256: createHash('sha256').update(contents).digest('hex'),
      },
    ],
  }
  const source = join(root, 'legacy import')
  await mkdir(source)
  await writeFile(join(source, 'weights.bin'), contents)
  const modelsPath = join(root, 'release models')
  const registry = new ModelRegistry(modelsPath, undefined, modelsPath)
  await new ModelInstaller(registry).install(model, {
    source,
    signal: new AbortController().signal,
  })
  await writeNotices(root, model)
  const manifestPath = join(root, 'models.json')
  await writeFile(manifestPath, JSON.stringify({ models: [model] }))
  const staging = join(root, 'staging')
  await stageManagedModelResources({
    repository: root,
    manifestPath,
    staging,
    environment: { REDENCUT_MODELS_PATH: modelsPath },
  })
  assert.deepEqual(
    await readFile(
      join(staging, 'models/diarization/diarization-default', model.revision, 'weights.bin'),
    ),
    contents,
  )
  assert.ok(await registry.resolve(model), 'staging must preserve the source installation')
})
