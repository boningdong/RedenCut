import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  downloadHuggingFaceFile,
  installManagedDiarization,
  resolveHuggingFaceToken,
  validateManagedDiarization,
} from './ManagedDiarizationModel.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const files = [
  { path: 'config.yaml', contents: 'pipeline: test', sha256: digest('pipeline: test') },
  { path: 'weights/model.bin', contents: 'weights', sha256: digest('weights') },
]
const model = {
  id: 'diarization-default',
  repository: 'example/model',
  revision: 'abc123',
  files: files.map(({ path, contents, sha256 }) => ({ path, size: contents.length, sha256 })),
}

async function root() {
  return mkdtemp(join(tmpdir(), 'redencut-model-test-'))
}

async function materialize(directory, selected = files) {
  for (const file of selected) {
    await mkdir(dirname(join(directory, file.path)), { recursive: true })
    await writeFile(join(directory, file.path), file.contents)
  }
  await writeFile(
    join(directory, 'installation.json'),
    `${JSON.stringify({ id: model.id, repository: model.repository, revision: model.revision, files: model.files }, null, 2)}\n`,
  )
}

test('reuses a verified installation without reading credentials or downloading', async () => {
  const modelsRoot = await root()
  const installed = join(modelsRoot, 'diarization', model.revision)
  await mkdir(installed, { recursive: true })
  await materialize(installed)
  let externalCalls = 0

  const result = await installManagedDiarization({
    modelsRoot,
    model,
    resolveToken: async () => {
      externalCalls += 1
    },
    downloadFile: async () => {
      externalCalls += 1
    },
    validateLoad: async () => {
      externalCalls += 1
    },
  })

  assert.equal(result.status, 'reused')
  assert.equal(externalCalls, 0)
})

test('rejects corruption and leaves an earlier verified installation selected after download failure', async () => {
  const modelsRoot = await root()
  const installed = join(modelsRoot, 'diarization', model.revision)
  await mkdir(installed, { recursive: true })
  await materialize(installed)
  await writeFile(join(installed, 'weights/model.bin'), 'corrupt')
  await assert.rejects(validateManagedDiarization(installed, model), /size|sha-256/i)

  await writeFile(join(installed, 'weights/model.bin'), 'weights')
  const newer = { ...model, revision: 'def456' }
  await assert.rejects(
    installManagedDiarization({
      modelsRoot,
      model: newer,
      token: 'secret',
      downloadFile: async ({ destination, file }) => {
        if (file.path.includes('weights')) throw new Error('interrupted')
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, files.find((item) => item.path === file.path).contents)
      },
      validateLoad: async () => {},
    }),
    /interrupted/,
  )
  assert.equal((await validateManagedDiarization(installed, model)).revision, model.revision)
  assert.deepEqual((await readdir(join(modelsRoot, 'diarization'))).sort(), [model.revision])
})

test('noninteractive missing credentials fails promptly with setup guidance', async () => {
  const modelsRoot = await root()
  await assert.rejects(
    installManagedDiarization({
      modelsRoot,
      model,
      nonInteractive: true,
      resolveToken: async () => undefined,
    }),
    /Hugging Face.*accept.*HF_TOKEN.*--skip-models/is,
  )
})

test('interactive setup explains access before hidden input and empty input explicitly skips', async () => {
  const modelsRoot = await root()
  const events = []
  const result = await installManagedDiarization({
    modelsRoot,
    model,
    nonInteractive: false,
    resolveToken: async () => undefined,
    onCredentialRequired: (message) => events.push(['guidance', message]),
    promptForToken: async () => {
      events.push(['prompt'])
      return undefined
    },
  })
  assert.equal(result.status, 'skipped')
  assert.equal(events[0][0], 'guidance')
  assert.match(events[0][1], /huggingface\.co\/join.*example\/model.*Enter.*skip/is)
  assert.equal(events[1][0], 'prompt')
})

test('an explicit missing credential path does not fall through to unrelated credentials', async () => {
  const credentialRoot = await root()
  await mkdir(join(credentialRoot, 'xdg', 'huggingface'), { recursive: true })
  await writeFile(join(credentialRoot, 'xdg', 'huggingface', 'token'), 'unrelated')
  assert.equal(
    await resolveHuggingFaceToken({
      environment: {
        HF_TOKEN_PATH: join(credentialRoot, 'missing'),
        XDG_CACHE_HOME: join(credentialRoot, 'xdg'),
      },
    }),
    undefined,
  )
  assert.equal(
    await resolveHuggingFaceToken({ environment: { XDG_CACHE_HOME: join(credentialRoot, 'xdg') } }),
    'unrelated',
  )
})

test('rejects unsafe model metadata before constructing an installation path', async () => {
  const modelsRoot = await root()
  for (const invalid of [
    { ...model, revision: '../escape' },
    { ...model, files: [] },
    { ...model, files: [{ ...model.files[0], path: '../escape' }] },
    { ...model, files: [model.files[0], model.files[0]] },
    { ...model, files: [{ ...model.files[0], size: -1 }] },
  ]) {
    await assert.rejects(
      installManagedDiarization({ modelsRoot, model: invalid, skip: true }),
      /revision|file|duplicate|size|unsafe|path/i,
    )
  }
})

test('does not forward credentials across redirects and enforces the pinned transfer size', async () => {
  const destinationRoot = await root()
  const requests = []
  const fetchImplementation = async (url, options) => {
    requests.push({ url: String(url), authorization: options.headers.Authorization })
    if (requests.length === 1)
      return new Response(null, { status: 302, headers: { location: 'https://cdn.example/model' } })
    return new Response('weights')
  }
  await downloadHuggingFaceFile({
    model,
    file: model.files[1],
    destination: join(destinationRoot, 'model.bin'),
    token: 'secret',
    fetchImplementation,
  })
  assert.equal(requests[0].authorization, 'Bearer secret')
  assert.equal(requests[1].authorization, undefined)

  await assert.rejects(
    downloadHuggingFaceFile({
      model,
      file: { ...model.files[1], size: 2 },
      destination: join(destinationRoot, 'oversized.bin'),
      token: 'secret',
      fetchImplementation: async () => new Response('weights'),
    }),
    /size/i,
  )
})

test('post-promotion cleanup failure does not roll back the selected valid installation', async () => {
  const modelsRoot = await root()
  const installed = join(modelsRoot, 'diarization', model.revision)
  await mkdir(installed, { recursive: true })
  await writeFile(join(installed, 'old'), 'invalid old installation')
  const warnings = []
  const result = await installManagedDiarization({
    modelsRoot,
    model,
    token: 'secret',
    downloadFile: async ({ destination, file }) => {
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, files.find((item) => item.path === file.path).contents)
    },
    validateLoad: async () => {},
    remove: async (path, options) => {
      if (path.includes('.previous-')) throw new Error('cleanup denied')
      return rm(path, options)
    },
    onWarning: (message) => warnings.push(message),
  })
  assert.equal(result.status, 'installed')
  assert.equal((await validateManagedDiarization(installed, model)).revision, model.revision)
  assert.match(warnings[0], /cleanup denied/)
})

test('explicit skip neither resolves credentials nor creates a model directory', async () => {
  const modelsRoot = await root()
  let asked = false
  const result = await installManagedDiarization({
    modelsRoot,
    model,
    skip: true,
    resolveToken: async () => {
      asked = true
    },
  })
  assert.equal(result.status, 'skipped')
  assert.equal(asked, false)
  await assert.rejects(readdir(join(modelsRoot, 'diarization')), /ENOENT/)
})

test('publishes only after offline load validation and removes failed staging', async () => {
  const modelsRoot = await root()
  let loadedPath
  await assert.rejects(
    installManagedDiarization({
      modelsRoot,
      model,
      token: 'secret',
      downloadFile: async ({ destination, file }) => {
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, files.find((item) => item.path === file.path).contents)
      },
      validateLoad: async (path) => {
        loadedPath = path
        throw new Error('cannot load')
      },
    }),
    /cannot load/,
  )
  assert.match(loadedPath, /\.staging-/)
  assert.deepEqual(await readdir(join(modelsRoot, 'diarization')), [])
})

test('imports an explicitly selected verified legacy directory', async () => {
  const modelsRoot = await root()
  const source = await root()
  await materialize(source)
  const result = await installManagedDiarization({
    modelsRoot,
    model,
    importModel: source,
    validateLoad: async () => {},
  })
  assert.equal(result.status, 'installed')
  assert.equal(
    JSON.parse(await readFile(join(result.path, 'installation.json'), 'utf8')).id,
    model.id,
  )
})
