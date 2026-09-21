#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { createDarwinArm64BuildPlan, requireSupportedBuildTarget } from './RuntimeBuildPlan.mjs'
import { sha256File } from './RuntimeIntegrity.mjs'
import { validateRuntimeDirectory } from './RuntimeVerifier.mjs'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lockPath = join(projectRoot, 'runtime', 'runtime-lock.json')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function run(file, arguments_, options = {}) {
  const result = await execFileAsync(file, arguments_, {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  return result.stdout
}

async function readLock() {
  return JSON.parse(await readFile(lockPath, 'utf8'))
}

async function validatePythonDependencyInputs(lock) {
  const pyprojectPath = join(projectRoot, 'speech-worker', 'pyproject.toml')
  const uvLockPath = join(projectRoot, 'speech-worker', 'uv.lock')
  const actual = {
    pyprojectSha256: await sha256File(pyprojectPath),
    uvLockSha256: await sha256File(uvLockPath),
  }
  assertLockedPythonDependencyHashes(lock.pythonDependencies, actual)
  return {
    ...actual,
    pythonDistributionSha256: lock.sources.pythonDistribution.sha256,
    pyavSourceSha256: lock.sources.pyav.sha256,
    uvToolSha256: lock.buildTools.uv.sha256,
    install: 'uv pip install --require-hashes --no-binary av',
  }
}

export function assertLockedPythonDependencyHashes(expected, actual) {
  if (
    actual.pyprojectSha256 !== expected.pyprojectSha256 ||
    actual.uvLockSha256 !== expected.uvLockSha256
  ) {
    throw new Error('speech-worker dependency files do not match runtime-lock.json')
  }
}

function recipeFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function readBuildMarker(prefix) {
  try {
    return JSON.parse(await readFile(join(prefix, '.redencut-build.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function listBuildOutputRecords(prefix) {
  const files = []
  const pending = [prefix]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const child of await readdir(current, { withFileTypes: true })) {
      if (current === prefix && child.name === '.redencut-build.json') continue
      const path = join(current, child.name)
      if (child.isDirectory()) pending.push(path)
      else if (child.isFile() || child.isSymbolicLink()) {
        files.push(relative(prefix, path).split(sep).join('/'))
      }
    }
  }
  files.sort()
  const records = []
  for (const path of files) records.push({ path, sha256: await sha256File(join(prefix, path)) })
  return records
}

export async function requireEmptyOrMatchingBuild(prefix, artifact, recipe) {
  if (!(await exists(artifact))) return false
  const marker = await readBuildMarker(prefix)
  if (marker?.recipeFingerprint === recipeFingerprint(recipe)) {
    const actualOutputs = await listBuildOutputRecords(prefix)
    if (JSON.stringify(actualOutputs) === JSON.stringify(marker.outputFiles)) return true
    throw new Error(`Build cache output integrity failure at ${prefix}; choose a fresh --work-dir`)
  }
  throw new Error(
    `Build cache at ${prefix} has no matching locked recipe marker; choose a fresh --work-dir`,
  )
}

async function writeBuildMarker(prefix, recipe) {
  const outputFiles = await listBuildOutputRecords(prefix)
  await writeFile(
    join(prefix, '.redencut-build.json'),
    `${JSON.stringify(
      { schemaVersion: 1, recipeFingerprint: recipeFingerprint(recipe), recipe, outputFiles },
      null,
      2,
    )}\n`,
  )
}

async function downloadAndVerify(source, downloadsRoot, onProgress = () => {}) {
  onProgress({ label: `Checking ${source.archive}` })
  const archivePath = join(downloadsRoot, source.archive)
  if (await exists(archivePath)) {
    const actual = await sha256File(archivePath)
    if (actual === source.sha256) return archivePath
    throw new Error(`Cached source hash mismatch for ${source.archive}: ${actual}`)
  }

  await mkdir(downloadsRoot, { recursive: true })
  const temporaryPath = `${archivePath}.download-${randomUUID()}`
  try {
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`Download failed (${response.status}) for ${source.url}`)
    const encoding = response.headers.get('content-encoding')
    const total =
      !encoding || encoding === 'identity'
        ? Number(response.headers.get('content-length'))
        : undefined
    const handle = await open(temporaryPath, 'wx')
    let completed = 0
    try {
      if (!response.body) throw new Error(`Empty download for ${source.archive}`)
      onProgress({ label: `Downloading ${source.archive}`, completed, total })
      for await (const chunk of response.body) {
        await handle.writeFile(chunk)
        completed += chunk.byteLength
        onProgress({ label: `Downloading ${source.archive}`, completed, total })
      }
    } finally {
      await handle.close()
    }
    onProgress({ label: `Verifying ${source.archive}` })
    const actual = await sha256File(temporaryPath)
    if (actual !== source.sha256) {
      throw new Error(`Downloaded source hash mismatch for ${source.archive}: ${actual}`)
    }
    await rename(temporaryPath, archivePath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return archivePath
}

async function extractSource(source, downloadsRoot, sourcesRoot) {
  if (!source.sourceDirectory) return
  const sourceRoot = join(sourcesRoot, source.sourceDirectory)
  if (await exists(sourceRoot)) return
  await mkdir(sourcesRoot, { recursive: true })
  await run('tar', ['-xf', join(downloadsRoot, source.archive), '-C', sourcesRoot])
  if (!(await exists(sourceRoot))) {
    throw new Error(`Source archive did not create expected directory: ${source.sourceDirectory}`)
  }
}

export async function freshExtractSource(source, downloadsRoot, sourcesRoot) {
  const sourceRoot = join(sourcesRoot, source.sourceDirectory)
  await rm(sourceRoot, { recursive: true, force: true })
  await extractSource(source, downloadsRoot, sourcesRoot)
  return sourceRoot
}

export async function bootstrapUv(lock, workRoot, onProgress = () => {}) {
  const source = lock.buildTools.uv
  const downloadsRoot = join(workRoot, 'downloads')
  const archivePath = await downloadAndVerify(source, downloadsRoot, onProgress)
  const toolRoot = join(workRoot, 'tools', `uv-${source.version}`)
  const executable = join(toolRoot, source.executable)
  if ((await exists(executable)) && (await sha256File(executable)) !== source.executableSha256) {
    await rm(toolRoot, { recursive: true })
  }
  if (!(await exists(executable))) {
    const stagingRoot = `${toolRoot}.staging-${randomUUID()}`
    await mkdir(stagingRoot, { recursive: true })
    try {
      await run('tar', ['-xf', archivePath, '-C', stagingRoot])
      if (!(await exists(join(stagingRoot, source.executable)))) {
        throw new Error(`Pinned uv archive is missing ${source.executable}`)
      }
      await mkdir(dirname(toolRoot), { recursive: true })
      await rename(stagingRoot, toolRoot)
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
  }
  await chmod(executable, 0o755)
  const executableSha256 = await sha256File(executable)
  if (executableSha256 !== source.executableSha256) {
    throw new Error(`Pinned uv executable hash mismatch: ${executableSha256}`)
  }
  const version = (await run(executable, ['--version'])).trim()
  if (!version.startsWith(`uv ${source.version} `) && version !== `uv ${source.version}`) {
    throw new Error(`Pinned uv version mismatch: ${version}`)
  }
  return executable
}

async function buildNativeSources(lock, workRoot, onProgress) {
  const plan = createDarwinArm64BuildPlan(workRoot)
  const sourcesRoot = join(workRoot, 'sources')
  const jobs = String(Math.max(1, Number.parseInt(process.env.REDENCUT_BUILD_JOBS ?? '4', 10)))

  onProgress({ label: 'Checking LAME build cache' })
  const lameRecipe = {
    sourceSha256: lock.sources.lame.sha256,
    configureArguments: plan.lame.configureArguments,
  }
  if (
    !(await requireEmptyOrMatchingBuild(
      plan.lame.prefix,
      join(plan.lame.prefix, 'lib', 'libmp3lame.0.dylib'),
      lameRecipe,
    ))
  ) {
    const sourceRoot = await freshExtractSource(
      lock.sources.lame,
      join(workRoot, 'downloads'),
      sourcesRoot,
    )
    onProgress({ label: 'Configuring LAME' })
    await run(join(sourceRoot, 'configure'), plan.lame.configureArguments, { cwd: sourceRoot })
    onProgress({ label: 'Compiling LAME' })
    await run('make', ['-j', jobs], { cwd: sourceRoot })
    onProgress({ label: 'Installing LAME' })
    await run('make', ['install'], { cwd: sourceRoot })
    const library = join(plan.lame.prefix, 'lib', 'libmp3lame.0.dylib')
    await run('install_name_tool', ['-id', '@rpath/libmp3lame.0.dylib', library])
    await run('codesign', ['--force', '--sign', '-', library])
    await writeBuildMarker(plan.lame.prefix, lameRecipe)
  }

  onProgress({ label: 'Checking FFmpeg build cache' })
  const ffmpegRecipe = {
    sourceSha256: lock.sources.ffmpeg.sha256,
    lameRecipeFingerprint: recipeFingerprint(lameRecipe),
    configureArguments: plan.ffmpeg.configureArguments,
  }
  if (
    !(await requireEmptyOrMatchingBuild(
      plan.ffmpeg.prefix,
      join(plan.ffmpeg.prefix, 'bin', 'ffmpeg'),
      ffmpegRecipe,
    ))
  ) {
    const sourceRoot = await freshExtractSource(
      lock.sources.ffmpeg,
      join(workRoot, 'downloads'),
      sourcesRoot,
    )
    const environment = {
      ...process.env,
      PKG_CONFIG_PATH: join(plan.lame.prefix, 'lib', 'pkgconfig'),
    }
    onProgress({ label: 'Configuring FFmpeg' })
    await run(join(sourceRoot, 'configure'), plan.ffmpeg.configureArguments, {
      cwd: sourceRoot,
      env: environment,
    })
    onProgress({ label: 'Compiling FFmpeg' })
    await run('make', ['-j', jobs], { cwd: sourceRoot, env: environment })
    onProgress({ label: 'Installing FFmpeg' })
    await run('make', ['install'], { cwd: sourceRoot, env: environment })
    await writeBuildMarker(plan.ffmpeg.prefix, ffmpegRecipe)
  }

  onProgress({ label: 'Checking whisper.cpp build cache' })
  const whisperRecipe = {
    sourceSha256: lock.sources.whisperCpp.sha256,
    cmakeArguments: plan.whisper.cmakeArguments,
  }
  if (
    !(await requireEmptyOrMatchingBuild(
      plan.whisper.prefix,
      join(plan.whisper.prefix, 'bin', 'whisper-cli'),
      whisperRecipe,
    ))
  ) {
    const sourceRoot = await freshExtractSource(
      lock.sources.whisperCpp,
      join(workRoot, 'downloads'),
      sourcesRoot,
    )
    await rm(plan.whisper.buildDirectory, { recursive: true, force: true })
    await mkdir(plan.whisper.buildDirectory, { recursive: true })
    onProgress({ label: 'Configuring whisper.cpp' })
    await run('cmake', [...plan.whisper.cmakeArguments, sourceRoot], {
      cwd: plan.whisper.buildDirectory,
    })
    onProgress({ label: 'Compiling whisper.cpp' })
    await run('cmake', ['--build', '.', '--parallel', jobs], { cwd: plan.whisper.buildDirectory })
    onProgress({ label: 'Installing whisper.cpp' })
    await run('cmake', ['--install', '.'], { cwd: plan.whisper.buildDirectory })
    await writeBuildMarker(plan.whisper.prefix, whisperRecipe)
  }
  return plan
}

async function exportLockedRequirements(workRoot, uvExecutable) {
  const outputPath = join(workRoot, 'python-requirements.txt')
  await run(
    uvExecutable,
    [
      'export',
      '--frozen',
      '--no-dev',
      '--no-emit-project',
      '--format',
      'requirements-txt',
      '--emit-index-url',
      '--output-file',
      outputPath,
    ],
    { cwd: join(projectRoot, 'speech-worker') },
  )
  return outputPath
}

async function addRelativeRpath(binaryPath, rpath) {
  const current = await run('otool', ['-l', binaryPath])
  if (!current.includes(`path ${rpath} `)) {
    await run('install_name_tool', ['-add_rpath', rpath, binaryPath])
  }
  await run('codesign', ['--force', '--sign', '-', binaryPath])
}

async function installPythonEnvironment(lock, workRoot, bundleRoot, ffmpegPrefix, uvExecutable) {
  const pythonRoot = join(bundleRoot, 'python')
  const pythonExecutable = join(pythonRoot, 'bin', 'python3')
  if (!(await exists(pythonExecutable))) {
    await run('tar', [
      '-xf',
      join(workRoot, 'downloads', lock.sources.pythonDistribution.archive),
      '-C',
      bundleRoot,
    ])
  }

  const packagesRoot = join(pythonRoot, 'lib', 'python3.11', 'site-packages')
  if (!(await exists(join(packagesRoot, 'torchcodec')))) {
    const requirementsPath = await exportLockedRequirements(workRoot, uvExecutable)
    const environment = {
      ...process.env,
      UV_CACHE_DIR: join(workRoot, 'uv-cache'),
      PKG_CONFIG_PATH: join(ffmpegPrefix, 'lib', 'pkgconfig'),
      LDFLAGS: '-Wl,-rpath,@loader_path/../../../../../lib',
      PYTHONNOUSERSITE: '1',
    }
    await run(
      uvExecutable,
      [
        'pip',
        'install',
        '--python',
        pythonExecutable,
        '--requirements',
        requirementsPath,
        '--require-hashes',
        '--no-binary',
        'av',
        '--index-strategy',
        'unsafe-best-match',
      ],
      { cwd: join(projectRoot, 'speech-worker'), env: environment },
    )
  }

  const torchCodecRoot = join(packagesRoot, 'torchcodec')
  for (const name of ['libtorchcodec_core7.dylib', 'libtorchcodec_custom_ops7.dylib']) {
    const library = join(torchCodecRoot, name)
    if (await exists(library)) await addRelativeRpath(library, '@loader_path/../../../../../lib')
  }
  await chmod(pythonExecutable, 0o755)
}

async function copyNativeRuntime(bundleRoot, plan) {
  const binRoot = join(bundleRoot, 'bin')
  const libRoot = join(bundleRoot, 'lib')
  await mkdir(binRoot, { recursive: true })
  await mkdir(libRoot, { recursive: true })
  for (const name of ['ffmpeg', 'ffprobe']) {
    await copyFile(join(plan.ffmpeg.prefix, 'bin', name), join(binRoot, name))
    await chmod(join(binRoot, name), 0o755)
  }
  await copyFile(join(plan.whisper.prefix, 'bin', 'whisper-cli'), join(binRoot, 'whisper-cli'))
  await chmod(join(binRoot, 'whisper-cli'), 0o755)

  const libraries = await readdir(join(plan.ffmpeg.prefix, 'lib'))
  for (const name of libraries.filter((entry) => /^lib.+\.\d+\.dylib$/.test(entry))) {
    await copyFile(await realpath(join(plan.ffmpeg.prefix, 'lib', name)), join(libRoot, name))
  }
  const lameLibrary = join(plan.lame.prefix, 'lib', 'libmp3lame.0.dylib')
  await copyFile(await realpath(lameLibrary), join(libRoot, basename(lameLibrary)))
}

async function copyComplianceMaterials(lock, workRoot, bundleRoot) {
  const sourcesRoot = join(workRoot, 'sources')
  const licensesRoot = join(bundleRoot, 'licenses')
  const bundleSourcesRoot = join(bundleRoot, 'sources')
  await mkdir(licensesRoot, { recursive: true })
  await mkdir(bundleSourcesRoot, { recursive: true })
  const licenses = [
    ['ffmpeg', 'COPYING.LGPLv2.1', 'FFmpeg-LGPL-2.1.txt'],
    ['lame', 'COPYING', 'LAME-LGPL-2.0.txt'],
    ['whisperCpp', 'LICENSE', 'whisper.cpp-MIT.txt'],
    ['python', 'LICENSE', 'CPython-PSF-2.0.txt'],
    ['pyav', 'LICENSE.txt', 'PyAV-BSD-3-Clause.txt'],
  ]
  for (const [key, sourceName, destinationName] of licenses) {
    const source = lock.sources[key]
    await copyFile(
      join(sourcesRoot, source.sourceDirectory, sourceName),
      join(licensesRoot, destinationName),
    )
  }
  for (const key of ['ffmpeg', 'lame', 'whisperCpp', 'python', 'pyav']) {
    const source = lock.sources[key]
    await copyFile(
      join(workRoot, 'downloads', source.archive),
      join(bundleSourcesRoot, source.archive),
    )
  }
}

function metadataHeaders(serialized) {
  const headers = new Map()
  let currentKey
  for (const line of serialized.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentKey) {
      headers.get(currentKey).at(-1).value += `\n${line.trim()}`
      continue
    }
    const separator = line.indexOf(':')
    if (separator < 1) continue
    currentKey = line.slice(0, separator)
    const values = headers.get(currentKey) ?? []
    values.push({ value: line.slice(separator + 1).trim() })
    headers.set(currentKey, values)
  }
  return headers
}

async function inventoryPythonPackages(bundleRoot) {
  const sitePackages = join(bundleRoot, 'python', 'lib', 'python3.11', 'site-packages')
  const entries = await readdir(sitePackages, { withFileTypes: true })
  const inventory = []
  for (const entry of entries.filter(
    (item) => item.isDirectory() && item.name.endsWith('.dist-info'),
  )) {
    const distributionRoot = join(sitePackages, entry.name)
    const metadata = metadataHeaders(await readFile(join(distributionRoot, 'METADATA'), 'utf8'))
    const relativeRoot = relative(bundleRoot, distributionRoot).split(sep).join('/')
    const licenseFiles = []
    const pending = [distributionRoot]
    while (pending.length > 0) {
      const current = pending.pop()
      for (const child of await readdir(current, { withFileTypes: true })) {
        const childPath = join(current, child.name)
        if (child.isDirectory()) pending.push(childPath)
        else if (/^(license|copying|notice)/i.test(child.name)) {
          licenseFiles.push(relative(bundleRoot, childPath).split(sep).join('/'))
        }
      }
    }
    inventory.push({
      name: metadata.get('Name')?.[0]?.value ?? entry.name.replace(/\.dist-info$/, ''),
      version: metadata.get('Version')?.[0]?.value ?? 'unknown',
      license:
        metadata.get('License-Expression')?.[0]?.value ??
        metadata.get('License')?.[0]?.value ??
        'NOASSERTION',
      licenseClassifiers: (metadata.get('Classifier') ?? [])
        .map(({ value }) => value)
        .filter((value) => value.startsWith('License ::')),
      declaredLicenseFiles: (metadata.get('License-File') ?? []).map(({ value }) => value),
      metadataPath: `${relativeRoot}/METADATA`,
      licenseFiles: licenseFiles.sort(),
    })
  }
  inventory.sort((left, right) => left.name.localeCompare(right.name))
  await writeFile(
    join(bundleRoot, 'licenses', 'python-packages.json'),
    `${JSON.stringify({ schemaVersion: 1, packages: inventory }, null, 2)}\n`,
  )
  return inventory
}

async function removePythonBytecode(bundleRoot) {
  const pythonRoot = join(bundleRoot, 'python')
  const pending = [pythonRoot]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const child of await readdir(current, { withFileTypes: true })) {
      const childPath = join(current, child.name)
      if (child.isDirectory() && child.name === '__pycache__') {
        await rm(childPath, { recursive: true })
      } else if (child.isDirectory()) {
        pending.push(childPath)
      } else if (child.isFile() && /\.py[co]$/.test(child.name)) {
        await rm(childPath)
      }
    }
  }
}

async function copyBuildEvidence(lock, workRoot, bundleRoot, plan, pythonRecipe) {
  const evidenceRoot = join(bundleRoot, 'build-evidence')
  await mkdir(evidenceRoot, { recursive: true })
  const evidenceFiles = [
    [
      join(workRoot, 'sources', lock.sources.ffmpeg.sourceDirectory, 'ffbuild', 'config.log'),
      'ffmpeg-config.log',
    ],
    [
      join(workRoot, 'sources', lock.sources.ffmpeg.sourceDirectory, 'ffbuild', 'config.mak'),
      'ffmpeg-config.mak',
    ],
    [join(workRoot, 'sources', lock.sources.lame.sourceDirectory, 'config.log'), 'lame-config.log'],
    [join(plan.whisper.buildDirectory, 'CMakeCache.txt'), 'whisper-CMakeCache.txt'],
  ]
  for (const [source, destination] of evidenceFiles) {
    if (await exists(source)) await copyFile(source, join(evidenceRoot, destination))
  }
  const clangVersion = (await run('clang', ['--version'])).split('\n')[0]
  await writeFile(
    join(evidenceRoot, 'build.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runtimeId: lock.runtimeId,
        target: 'darwin-arm64',
        generatedAt: new Date().toISOString(),
        toolchain: { clang: clangVersion },
        recipes: {
          lame: plan.lame.configureArguments,
          ffmpeg: plan.ffmpeg.configureArguments,
          whisperCpp: plan.whisper.cmakeArguments,
          python: pythonRecipe,
        },
        sources: lock.sources,
        buildTools: lock.buildTools,
      },
      null,
      2,
    )}\n`,
  )
}

async function listFiles(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const child of await readdir(current, { withFileTypes: true })) {
      if (current === root && child.name === 'manifest.json') continue
      const path = join(current, child.name)
      if (child.isDirectory()) pending.push(path)
      else if (child.isFile() || child.isSymbolicLink()) {
        files.push(relative(root, path).split(sep).join('/'))
      }
    }
  }
  files.sort()
  const records = []
  for (const path of files) records.push({ path, sha256: await sha256File(join(root, path)) })
  return records
}

async function writeManifest(lock, bundleRoot) {
  const components = Object.entries(lock.sources).map(([name, source]) => ({
    name,
    version: source.version,
    license: source.license,
    sourceUrl: source.url,
    sourceSha256: source.sha256,
  }))
  const manifest = {
    schemaVersion: 1,
    runtimeId: lock.runtimeId,
    platform: 'darwin',
    arch: 'arm64',
    executables: {
      ffmpeg: 'bin/ffmpeg',
      ffprobe: 'bin/ffprobe',
      'whisper-cli': 'bin/whisper-cli',
      python: 'python/bin/python3',
    },
    components,
    files: await listFiles(bundleRoot),
  }
  await writeFile(join(bundleRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function completeBundle(lock, workRoot, bundleRoot, plan, pythonRecipe) {
  await removePythonBytecode(bundleRoot)
  await copyComplianceMaterials(lock, workRoot, bundleRoot)
  await inventoryPythonPackages(bundleRoot)
  await copyBuildEvidence(lock, workRoot, bundleRoot, plan, pythonRecipe)
  await writeManifest(lock, bundleRoot)
  await validateRuntimeDirectory(bundleRoot)
}

async function validateExistingBundle(lock, bundleRoot, plan, pythonRecipe) {
  const manifest = await validateRuntimeDirectory(bundleRoot)
  if (
    manifest.runtimeId !== lock.runtimeId ||
    manifest.platform !== 'darwin' ||
    manifest.arch !== 'arm64'
  ) {
    throw new Error(`Existing bundle at ${bundleRoot} does not match the locked runtime identity`)
  }
  const components = new Map(manifest.components.map((component) => [component.name, component]))
  for (const [name, source] of Object.entries(lock.sources)) {
    const component = components.get(name)
    if (
      component?.version !== source.version ||
      component?.sourceUrl !== source.url ||
      component?.sourceSha256 !== source.sha256
    ) {
      throw new Error(`Existing bundle component ${name} does not match runtime-lock.json`)
    }
  }
  const evidence = JSON.parse(
    await readFile(join(bundleRoot, 'build-evidence', 'build.json'), 'utf8'),
  )
  if (JSON.stringify(evidence.buildTools) !== JSON.stringify(lock.buildTools)) {
    throw new Error(`Existing bundle at ${bundleRoot} used different locked build tools`)
  }
  const expectedRecipes = {
    lame: plan.lame.configureArguments,
    ffmpeg: plan.ffmpeg.configureArguments,
    whisperCpp: plan.whisper.cmakeArguments,
    python: pythonRecipe,
  }
  if (JSON.stringify(evidence.recipes) !== JSON.stringify(expectedRecipes)) {
    throw new Error(
      `Existing bundle at ${bundleRoot} was built with a different recipe; choose a fresh --bundle-dir`,
    )
  }
  return manifest
}

async function replaceBundle(stagingRoot, bundleRoot) {
  const previousRoot = `${bundleRoot}.previous-${randomUUID()}`
  let movedPrevious = false
  try {
    if (await exists(bundleRoot)) {
      await rename(bundleRoot, previousRoot)
      movedPrevious = true
    }
    await rename(stagingRoot, bundleRoot)
    if (movedPrevious) await rm(previousRoot, { recursive: true })
  } catch (error) {
    if (movedPrevious && !(await exists(bundleRoot))) await rename(previousRoot, bundleRoot)
    throw error
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

function parseArguments(arguments_) {
  const options = {}
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--work-dir') options.workDirectory = arguments_[++index]
    else if (argument === '--bundle-dir') options.bundleDirectory = arguments_[++index]
    else throw new Error(`Unknown BuildRuntime argument: ${argument}`)
  }
  return options
}

export async function buildRuntime({ workDirectory, bundleDirectory, onProgress = () => {} } = {}) {
  onProgress({ label: 'Checking runtime requirements' })
  requireSupportedBuildTarget(process.platform, process.arch)
  const workRoot = resolve(workDirectory ?? join(projectRoot, '.runtime', 'build-cache'))
  const bundleRoot = resolve(
    bundleDirectory ?? join(projectRoot, '.runtime', 'build', 'darwin-arm64-bundle'),
  )
  const lock = await readLock()
  const pythonRecipe = await validatePythonDependencyInputs(lock)
  const downloadsRoot = join(workRoot, 'downloads')
  const sourcesRoot = join(workRoot, 'sources')
  await mkdir(downloadsRoot, { recursive: true })
  await mkdir(sourcesRoot, { recursive: true })
  for (const source of Object.values(lock.sources)) {
    await downloadAndVerify(source, downloadsRoot, onProgress)
    onProgress({ label: `Extracting ${source.archive}` })
    await extractSource(source, downloadsRoot, sourcesRoot)
  }
  const uvExecutable = await bootstrapUv(lock, workRoot, onProgress)
  const plan = await buildNativeSources(lock, workRoot, onProgress)

  if (
    (await exists(join(bundleRoot, 'manifest.json'))) ||
    (await exists(join(bundleRoot, 'bin'))) ||
    (await exists(join(bundleRoot, 'python')))
  ) {
    onProgress({ label: 'Validating existing runtime bundle' })
    await validateExistingBundle(lock, bundleRoot, plan, pythonRecipe)
    return bundleRoot
  }

  const stagingRoot = `${bundleRoot}.staging-${randomUUID()}`
  await mkdir(dirname(bundleRoot), { recursive: true })
  await mkdir(stagingRoot, { recursive: true })
  try {
    onProgress({ label: 'Assembling native runtime' })
    await copyNativeRuntime(stagingRoot, plan)
    onProgress({ label: 'Installing Python dependencies and building PyAV' })
    await installPythonEnvironment(lock, workRoot, stagingRoot, plan.ffmpeg.prefix, uvExecutable)
    onProgress({ label: 'Packaging and verifying runtime files' })
    await completeBundle(lock, workRoot, stagingRoot, plan, pythonRecipe)
    await replaceBundle(stagingRoot, bundleRoot)
    return bundleRoot
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bundleRoot = await buildRuntime(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${resolve(bundleRoot)}\n`)
}
