#!/usr/bin/env node

import { parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createRuntimeProgress } from './RuntimeProgress.mjs'

import { buildRuntime } from './BuildRuntime.mjs'
import { installRuntimeGeneration } from './RuntimeInstaller.mjs'

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
    else throw new Error(`Unknown SetupRuntime argument: ${argument}`)
  }
  return parsed
}

export async function setupRuntime({
  bundleRoot,
  runtimeRoot,
  environment = process.env,
  onProgress = () => {},
} = {}) {
  runtimeRoot ??= environment.REDENCUT_RUNTIME_ROOT
  const destinationRoot = assertSafeInstallDestination(
    runtimeRoot ?? resolve('.runtime', `${process.platform}-${process.arch}`),
  )
  const sourceRoot = bundleRoot ? resolve(bundleRoot) : await buildRuntime({ onProgress })
  if (resolve(sourceRoot) === destinationRoot) {
    throw new Error('Runtime bundle and installation destination must be different directories')
  }
  onProgress({ label: 'Installing and verifying managed runtime' })
  const runtimeManifest = await installRuntimeGeneration({
    bundleRoot: sourceRoot,
    destinationRoot,
  })
  return { runtimeManifest }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const progress = createRuntimeProgress()
  let result
  try {
    result = await setupRuntime({
      ...options,
      onProgress: progress.update,
    })
    progress.finish('Runtime setup complete')
  } catch (error) {
    progress.finish('Runtime setup failed', false)
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
    return
  } finally {
    progress.pause()
  }
  if (result.runtimeManifest)
    process.stdout.write(`Installed managed runtime ${result.runtimeManifest.runtimeId}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
