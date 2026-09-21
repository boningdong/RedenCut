#!/usr/bin/env node

import { dirname, join, parse, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildRuntime } from './BuildRuntime.mjs'
import { installRuntimeGeneration } from './RuntimeInstaller.mjs'
import { installManagedDiarization } from './ManagedDiarizationModel.mjs'
import { loadDiarizationModel } from './ManagedModelManifest.mjs'
import { runManagedPython } from './RunPython.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function assertSafeInstallDestination(destination) {
  const resolved = resolve(destination)
  if (resolved === parse(resolved).root) throw new Error(`Unsafe runtime destination: ${resolved}`)
  if (resolved === resolve(process.cwd()))
    throw new Error(`Runtime destination cannot be the project root: ${resolved}`)
  return resolved
}

export function parseArguments(arguments_) {
  const parsed = {}
  const readValue = (flag, index) => {
    const value = arguments_[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path value`)
    return value
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--bundle') parsed.bundleRoot = readValue(argument, index++)
    else if (argument === '--runtime-root') parsed.runtimeRoot = readValue(argument, index++)
    else if (argument === '--models-root') parsed.modelsRoot = readValue(argument, index++)
    else if (argument === '--import-model') parsed.importModel = readValue(argument, index++)
    else if (argument === '--models-only') parsed.modelsOnly = true
    else if (argument === '--skip-models') parsed.skipModels = true
    else throw new Error(`Unknown SetupRuntime argument: ${argument}`)
  }
  return parsed
}

async function promptHidden(message) {
  if (!process.stdin.isTTY) return undefined
  process.stdout.write(message)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolvePromise, reject) => {
    let value = ''
    const finish = (error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolvePromise(value.trim() || undefined)
    }
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('Credential input cancelled'))
        if (byte === 10 || byte === 13) return finish()
        if (byte === 127) value = value.slice(0, -1)
        else value += String.fromCharCode(byte)
      }
    }
    process.stdin.on('data', onData)
  })
}

export async function setupRuntime({
  bundleRoot,
  runtimeRoot,
  modelsRoot,
  modelsOnly = false,
  skipModels = false,
  importModel,
  installModel = installManagedDiarization,
  runPython = runManagedPython,
  environment = process.env,
} = {}) {
  runtimeRoot ??= environment.REDENCUT_RUNTIME_ROOT
  modelsRoot ??= environment.REDENCUT_MODELS_ROOT ?? resolve('.runtime', 'models')
  const destinationRoot = assertSafeInstallDestination(
    runtimeRoot ?? resolve('.runtime', `${process.platform}-${process.arch}`),
  )
  let runtimeManifest
  if (!modelsOnly) {
    const sourceRoot = bundleRoot ? resolve(bundleRoot) : await buildRuntime()
    if (resolve(sourceRoot) === destinationRoot) {
      throw new Error('Runtime bundle and installation destination must be different directories')
    }
    runtimeManifest = await installRuntimeGeneration({ bundleRoot: sourceRoot, destinationRoot })
  }
  const model = await loadDiarizationModel(join(repository, 'speech-worker', 'models.json'))
  const modelResult = await installModel({
    modelsRoot,
    runtimeRoot: destinationRoot,
    model,
    skip: skipModels,
    importModel,
    promptForToken: () => promptHidden('Hugging Face read token: '),
    validateLoad: async (path) => {
      const cache = await mkdtemp(join(tmpdir(), 'redencut-model-validation-'))
      try {
        const exitCode = await runPython({
          runtimeRoot: destinationRoot,
          cwd: cache,
          environment: {
            ORT_DISABLE_TELEMETRY: '1',
            MPLCONFIGDIR: join(cache, 'matplotlib'),
            HF_TOKEN: undefined,
            HUGGING_FACE_HUB_TOKEN: undefined,
            HUGGINGFACE_TOKEN: undefined,
            HF_TOKEN_PATH: undefined,
            HF_HOME: undefined,
          },
          pythonPath: join(repository, 'speech-worker', 'src'),
          pythonArguments: [
            '-m',
            'redencut_speech_worker.validate_model',
            '--manifest',
            join(repository, 'speech-worker', 'models.json'),
            '--model-id',
            model.id,
            '--path',
            path,
          ],
        })
        if (exitCode !== 0)
          throw new Error(`Offline diarization load validation failed (${exitCode})`)
      } finally {
        await rm(cache, { recursive: true, force: true })
      }
    },
  })
  return { runtimeManifest, model: modelResult }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const result = await setupRuntime(options)
  if (result.runtimeManifest)
    process.stdout.write(`Installed managed runtime ${result.runtimeManifest.runtimeId}\n`)
  process.stdout.write(`Managed diarization model: ${result.model.status}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
