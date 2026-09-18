#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createManagedPythonEnvironment } from './RuntimeEnvironment.mjs'
import { resolveRuntimePath } from './RuntimePaths.mjs'
import { validateRuntimeDirectory } from './RuntimeVerifier.mjs'

export function parseRunPythonArguments(arguments_) {
  const options = { pythonArguments: [] }
  let index = 0
  for (; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--') {
      options.pythonArguments = arguments_.slice(index + 1)
      break
    }
    if (argument === '--runtime-root') options.runtimeRoot = arguments_[++index]
    else if (argument === '--python-path') options.pythonPath = arguments_[++index]
    else throw new Error(`Unknown RunPython argument: ${argument}`)
  }
  return options
}

export async function runManagedPython({
  runtimeRoot = resolve('.runtime', `${process.platform}-${process.arch}`),
  pythonPath,
  pythonArguments = [],
  stdio = 'inherit',
} = {}) {
  const root = resolve(runtimeRoot)
  const manifest = await validateRuntimeDirectory(root)
  if (!manifest.executables.python) throw new Error('Managed runtime does not provide Python')
  const python = resolveRuntimePath(root, manifest.executables.python)
  const environment = createManagedPythonEnvironment(root)
  if (pythonPath) environment.PYTHONPATH = resolve(pythonPath)

  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, pythonArguments, { cwd: process.cwd(), env: environment, stdio })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Managed Python terminated by ${signal}`))
      else resolvePromise(code ?? 1)
    })
  })
}

async function main() {
  const options = parseRunPythonArguments(process.argv.slice(2))
  const exitCode = await runManagedPython(options)
  process.exitCode = exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
