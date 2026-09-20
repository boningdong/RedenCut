#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { validateManagedDiarization } from './runtime/ManagedDiarizationModel.mjs'
import { loadDiarizationModel } from './runtime/ManagedModelManifest.mjs'

const defaultRepository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const diarizationNoticeFiles = [
  'CHANGE-NOTICE.txt',
  'LICENSE-NOTICE.txt',
  'SOURCE.txt',
  'UPSTREAM-METADATA.json',
  'UPSTREAM-README.md',
]

function gitBlobSha1(contents) {
  return createHash('sha1').update(`blob ${contents.byteLength}\0`).update(contents).digest('hex')
}

export async function validateDiarizationNotices(directory, model) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Required diarization notice directory is unavailable: ${error.message}`)
  }
  const names = entries.map(({ name }) => name).sort()
  if (JSON.stringify(names) !== JSON.stringify(diarizationNoticeFiles)) {
    const missing = diarizationNoticeFiles.filter((name) => !names.includes(name))
    const unexpected = names.filter((name) => !diarizationNoticeFiles.includes(name))
    throw new Error(
      `Diarization notice inventory is invalid${missing.length ? `; missing ${missing.join(', ')}` : ''}${unexpected.length ? `; unexpected ${unexpected.join(', ')}` : ''}`,
    )
  }
  const contents = new Map()
  for (const entry of entries) {
    const path = join(directory, entry.name)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0)
      throw new Error(`Diarization notice must be a nonempty regular file: ${entry.name}`)
    contents.set(entry.name, await readFile(path))
  }
  const text = (name) => contents.get(name).toString('utf8')
  if (!/Creative Commons Attribution 4\.0|CC-BY-4\.0/i.test(text('LICENSE-NOTICE.txt')))
    throw new Error('Diarization license notice does not identify CC-BY-4.0')
  if (
    !/attribution/i.test(text('LICENSE-NOTICE.txt')) ||
    !/citation/i.test(text('LICENSE-NOTICE.txt'))
  )
    throw new Error('Diarization license notice lacks attribution and citation guidance')
  const source = text('SOURCE.txt')
  for (const expected of [
    `Model: ${model.repository}`,
    `Source: https://huggingface.co/${model.repository}`,
    `Revision: ${model.revision}`,
    'License: CC-BY-4.0',
  ]) {
    if (!source.includes(expected)) throw new Error(`Diarization source notice lacks: ${expected}`)
  }
  if (!/without modifying their contents/i.test(text('CHANGE-NOTICE.txt')))
    throw new Error('Diarization change notice does not describe redistributed model changes')

  let metadata
  try {
    metadata = JSON.parse(text('UPSTREAM-METADATA.json'))
  } catch (error) {
    throw new Error(`Diarization upstream metadata is invalid JSON: ${error.message}`)
  }
  const expectedApiSource = `https://huggingface.co/api/models/${model.repository}/revision/${model.revision}?blobs=true`
  if (
    metadata.source !== expectedApiSource ||
    metadata.repository !== model.repository ||
    metadata.revision !== model.revision
  )
    throw new Error('Diarization upstream metadata does not match the pinned source revision')
  for (const file of model.files) {
    const recorded = metadata.files?.find(({ path }) => path === file.path)
    if (!recorded || recorded.size !== file.size || recorded.sha256 !== file.sha256)
      throw new Error(`Diarization upstream metadata does not match pinned file: ${file.path}`)
  }
  const modelCard = contents.get('UPSTREAM-README.md')
  if (
    metadata.modelCard?.path !== 'README.md' ||
    metadata.modelCard.size !== modelCard.byteLength ||
    metadata.modelCard.gitBlobSha1 !== gitBlobSha1(modelCard)
  )
    throw new Error('Diarization upstream model card size or hash does not match metadata')
  return diarizationNoticeFiles
}

export async function stageManagedModelResources({
  repository = defaultRepository,
  staging,
  manifestPath = join(repository, 'speech-worker', 'models.json'),
  modelsRoot = join(repository, '.runtime', 'models'),
}) {
  const model = await loadDiarizationModel(manifestPath)
  const source = join(modelsRoot, 'diarization', model.revision)
  try {
    await validateManagedDiarization(source, model)
  } catch (error) {
    throw new Error(`Required managed diarization model is absent or invalid: ${error.message}`)
  }
  const destination = join(staging, 'models', 'diarization', model.revision)
  await mkdir(destination, { recursive: true })
  for (const file of [...model.files.map(({ path }) => path), 'installation.json']) {
    await mkdir(dirname(join(destination, file)), { recursive: true })
    await cp(join(source, file), join(destination, file), { errorOnExist: true, force: false })
  }
  const licenseSource = join(repository, 'speech-worker', 'licenses', 'diarization')
  const noticeFiles = await validateDiarizationNotices(licenseSource, model)
  const noticeDestination = join(
    staging,
    'third-party-notices',
    'pyannote-speaker-diarization-community-1',
  )
  await mkdir(noticeDestination, { recursive: true })
  for (const file of noticeFiles)
    await cp(join(licenseSource, file), join(noticeDestination, file), {
      errorOnExist: true,
      force: false,
    })
  return { model, destination }
}

function parseArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    if (!['--resources-dir', '--bundle'].includes(args[index]) || !args[index + 1])
      throw new Error(
        'Usage: npm run runtime:stage -- --resources-dir NEW_DIRECTORY [--bundle RUNTIME_BUNDLE]',
      )
    options[args[index]] = args[index + 1]
  }
  if (!options['--resources-dir'])
    throw new Error('--resources-dir must name a new release resources directory')
  return options
}

export async function stageReleaseResources(args = process.argv.slice(2)) {
  const options = parseArguments(args)
  const destination = resolve(options['--resources-dir'])
  try {
    await lstat(destination)
    throw new Error(`Refusing to replace an existing resources directory: ${destination}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const bundle = resolve(
    options['--bundle'] ??
      join(defaultRepository, '.runtime', `${process.platform}-${process.arch}`),
  )
  const staging = join(dirname(destination), `.redencut-release-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    execFileSync(
      process.execPath,
      [
        join(defaultRepository, 'scripts/runtime/SetupRuntime.mjs'),
        '--bundle',
        bundle,
        '--runtime-root',
        join(staging, 'runtime'),
        '--skip-models',
      ],
      { stdio: 'inherit' },
    )
    await cp(join(defaultRepository, 'speech-worker/src'), join(staging, 'speech-worker/src'), {
      recursive: true,
      filter: (path) => !path.split('/').includes('__pycache__') && !path.endsWith('.pyc'),
    })
    await cp(
      join(defaultRepository, 'speech-worker/models.json'),
      join(staging, 'speech-worker/models.json'),
    )
    await stageManagedModelResources({ repository: defaultRepository, staging })
    const notices = join(staging, 'third-party-notices')
    await mkdir(notices, { recursive: true })
    for (const name of ['LICENSE', 'LICENSES.chromium.html'])
      await cp(
        join(defaultRepository, 'node_modules/electron/dist', name),
        join(notices, `Electron-${name}`),
      )
    await cp(join(defaultRepository, 'LICENSE'), join(staging, 'PROJECT-LICENSE'))
    await writeFile(
      join(staging, 'STAGING-README.txt'),
      [
        'These are release resource inputs, not a signed or distributable application.',
        'Original RedenCut project code is licensed under Apache-2.0; third-party software and models retain their respective licenses.',
        'The managed diarization model is pinned, integrity checked, load validated, and accompanied by source, license, and change notices.',
        'Retain runtime source archives, licenses, notices, build configuration and manifest with distribution materials.',
        'An application packager must place runtime/, models/, and speech-worker/ outside app.asar, preserve symlinks and executable permissions, and include Electron/Chromium notices.',
        'Final signing, notarization, clean-machine loading, full third-party inventory and LGPL replacement/relinking compliance remain release checks.',
        '',
      ].join('\n'),
    )
    await rename(staging, destination)
    execFileSync(
      process.execPath,
      [
        join(defaultRepository, 'scripts/runtime/CheckRuntime.mjs'),
        '--runtime-root',
        join(destination, 'runtime'),
      ],
      { stdio: 'inherit' },
    )
    console.log(`Release resource inputs staged at ${destination}`)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await stageReleaseResources()
