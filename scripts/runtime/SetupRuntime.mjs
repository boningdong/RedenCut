#!/usr/bin/env node

import { parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildRuntime } from './BuildRuntime.mjs'
import { installRuntimeGeneration } from './RuntimeInstaller.mjs'

export function assertSafeInstallDestination(destination) {
  const resolved = resolve(destination)
  if (resolved === parse(resolved).root) throw new Error(`Unsafe runtime destination: ${resolved}`)
  if (resolved === resolve(process.cwd()))
    throw new Error(`Runtime destination cannot be the project root: ${resolved}`)
  return resolved
}

function parseArguments(arguments_) {
  const parsed = {}
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--bundle') parsed.bundleRoot = arguments_[++index]
    else if (argument === '--runtime-root') parsed.runtimeRoot = arguments_[++index]
    else throw new Error(`Unknown SetupRuntime argument: ${argument}`)
  }
  return parsed
}

export async function setupRuntime({ bundleRoot, runtimeRoot } = {}) {
  const destinationRoot = assertSafeInstallDestination(
    runtimeRoot ?? resolve('.runtime', `${process.platform}-${process.arch}`),
  )
  const sourceRoot = bundleRoot ? resolve(bundleRoot) : await buildRuntime()
  if (resolve(sourceRoot) === destinationRoot) {
    throw new Error('Runtime bundle and installation destination must be different directories')
  }
  return installRuntimeGeneration({ bundleRoot: sourceRoot, destinationRoot })
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const manifest = await setupRuntime(options)
  process.stdout.write(`Installed managed runtime ${manifest.runtimeId}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
