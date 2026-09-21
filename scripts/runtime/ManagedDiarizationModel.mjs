import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { assertSafeRuntimeRelativePath } from './RuntimePaths.mjs'
import { validateDiarizationModel } from './ManagedModelManifest.mjs'

const TOKEN_ENVIRONMENT_KEYS = ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACE_TOKEN']

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function installationRecord(model) {
  return {
    id: model.id,
    repository: model.repository,
    revision: model.revision,
    files: model.files,
  }
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

export async function resolveHuggingFaceToken({ environment = process.env } = {}) {
  for (const key of TOKEN_ENVIRONMENT_KEYS) {
    if (environment[key]?.trim()) return environment[key].trim()
  }
  let candidates
  if (environment.HF_TOKEN_PATH) candidates = [environment.HF_TOKEN_PATH]
  else if (environment.HF_HOME) candidates = [join(environment.HF_HOME, 'token')]
  else
    candidates = [
      join(environment.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'huggingface', 'token'),
    ]
  for (const path of candidates) {
    try {
      const token = (await readFile(path, 'utf8')).trim()
      if (token) return token
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') throw error
    }
  }
  return undefined
}

export async function downloadHuggingFaceFile({
  model,
  file,
  destination,
  token,
  fetchImplementation = fetch,
  timeoutMilliseconds = 300_000,
  maxRedirects = 5,
  onProgress = () => {},
}) {
  let url = new URL(
    `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
  )
  let response
  for (let redirects = 0; ; redirects += 1) {
    if (redirects > maxRedirects) throw new Error(`Too many redirects downloading ${file.path}`)
    const headers = {}
    if (url.protocol === 'https:' && url.hostname === 'huggingface.co')
      headers.Authorization = `Bearer ${token}`
    response = await fetchImplementation(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMilliseconds),
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location) throw new Error(`Hugging Face redirect lacks a location for ${file.path}`)
    url = new URL(location, url)
  }
  if (!response.ok)
    throw new Error(`Hugging Face download failed for ${file.path} (${response.status})`)
  const declaredSize = response.headers.get('content-length')
  if (declaredSize !== null && Number(declaredSize) !== file.size)
    throw new Error(`Hugging Face download size mismatch for ${file.path}`)
  await mkdir(dirname(destination), { recursive: true })
  const handle = await open(destination, 'wx')
  let received = 0
  onProgress({ label: `Downloading model: ${file.path}`, completed: 0, total: file.size })
  try {
    if (!response.body) throw new Error(`Hugging Face download has no body for ${file.path}`)
    for await (const chunk of response.body) {
      received += chunk.byteLength
      if (received > file.size)
        throw new Error(`Hugging Face download size mismatch for ${file.path}`)
      await handle.writeFile(chunk)
      onProgress({
        label: `Downloading model: ${file.path}`,
        completed: received,
        total: file.size,
      })
    }
    if (received !== file.size)
      throw new Error(`Hugging Face download size mismatch for ${file.path}`)
  } finally {
    await handle.close()
  }
}

export async function installManagedDiarization({
  modelsRoot,
  model,
  skip = false,
  importModel,
  nonInteractive = !process.stdin.isTTY,
  token,
  resolveToken = resolveHuggingFaceToken,
  promptForToken,
  downloadFile = downloadHuggingFaceFile,
  validateLoad,
  onCredentialRequired = (message) => process.stdout.write(`${message}\n`),
  remove = rm,
  onProgress = () => {},
  onWarning = (message) => process.stderr.write(`Warning: ${message}\n`),
}) {
  validateDiarizationModel(model)
  if (skip) return { status: 'skipped' }
  onProgress({ label: 'Checking diarization model' })
  const destination = resolve(modelsRoot, 'diarization', model.revision)
  try {
    await validateManagedDiarization(destination, model)
    return { status: 'reused', path: destination, revision: model.revision }
  } catch {
    // Missing and corrupt installations are rebuilt in a sibling staging directory.
  }

  let credential = token
  if (!importModel) {
    credential ??= await resolveToken()
    if (!credential) {
      const guidance = `Hugging Face access is required. Sign up at https://huggingface.co/join and accept the model conditions at https://huggingface.co/${model.repository}, then use a read token via HF_TOKEN or hf auth login.`
      if (nonInteractive)
        throw new Error(`${guidance} To continue without diarization, rerun with --skip-models.`)
      onCredentialRequired(`${guidance} Enter a token now, or press Enter to skip the model.`)
      credential = promptForToken ? await promptForToken() : undefined
      if (!credential) return { status: 'skipped' }
    }
  }

  const parent = dirname(destination)
  const staging = join(parent, `.${basename(destination)}.staging-${randomUUID()}`)
  const displaced = join(parent, `.${basename(destination)}.previous-${randomUUID()}`)
  await mkdir(parent, { recursive: true })
  let movedPrevious = false
  try {
    await mkdir(staging)
    if (importModel) {
      onProgress({ label: 'Verifying imported model' })
      await validateModelFiles(resolve(importModel), model)
      for (const file of model.files) {
        await mkdir(dirname(join(staging, file.path)), { recursive: true })
        await cp(join(resolve(importModel), file.path), join(staging, file.path), {
          errorOnExist: true,
        })
      }
    } else {
      for (const file of model.files) {
        await downloadFile({
          model,
          file,
          destination: join(staging, file.path),
          token: credential,
          onProgress,
        })
      }
    }
    await writeFile(
      join(staging, 'installation.json'),
      `${JSON.stringify(installationRecord(model), null, 2)}\n`,
      { flag: 'wx' },
    )
    onProgress({ label: 'Verifying model files' })
    await validateManagedDiarization(staging, model)
    if (!validateLoad) throw new Error('Managed diarization load validator is required')
    onProgress({ label: 'Testing offline model loading' })
    await validateLoad(staging, model)
    try {
      await rename(destination, displaced)
      movedPrevious = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await rename(staging, destination)
  } catch (error) {
    let cleanupError
    try {
      await remove(staging, { recursive: true, force: true })
    } catch (candidate) {
      cleanupError = candidate
    }
    if (movedPrevious) await rename(displaced, destination)
    if (cleanupError)
      throw new AggregateError(
        [error, cleanupError],
        'Model installation and staging cleanup failed',
      )
    throw error
  }
  if (movedPrevious) {
    try {
      await remove(displaced, { recursive: true })
    } catch (error) {
      onWarning(`Installed the managed model but could not remove ${displaced}: ${error.message}`)
    }
  }
  return { status: 'installed', path: destination, revision: model.revision }
}
