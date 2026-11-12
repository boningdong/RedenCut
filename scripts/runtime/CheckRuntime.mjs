#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { probeRuntimeLoads } from './ProbeRuntimeLoads.mjs'
import { verifyAlignmentOffline } from './VerifyAlignmentOffline.mjs'
import { validateRuntimeDirectory } from './RuntimeVerifier.mjs'

function classifyVerificationError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/missing runtime manifest/i.test(message)) return 'missing'
  if (/schemaVersion|schema version/i.test(message)) return 'version-mismatch'
  return 'integrity-failed'
}

export async function checkRuntime(
  root,
  { platform = process.platform, arch = process.arch, loadExecutables = true } = {},
) {
  let manifest
  try {
    manifest = await validateRuntimeDirectory(root)
  } catch (error) {
    return {
      status: classifyVerificationError(error),
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (manifest.platform !== platform || manifest.arch !== arch) {
    return {
      status: 'wrong-architecture',
      message: `Runtime targets ${manifest.platform}-${manifest.arch}; expected ${platform}-${arch}`,
      runtimeId: manifest.runtimeId,
    }
  }

  if (loadExecutables) {
    try {
      await probeRuntimeLoads(root, manifest)
    } catch (error) {
      return {
        status: 'load-failed',
        message: error instanceof Error ? error.message : String(error),
        runtimeId: manifest.runtimeId,
      }
    }
  }

  return { status: 'ready', runtimeId: manifest.runtimeId, manifest }
}

function parseCheckArguments(arguments_) {
  let runtimeRoot
  let modelsRoot
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--runtime-root') runtimeRoot = arguments_[++index]
    else if (argument === '--models-root') modelsRoot = arguments_[++index]
    else if (!runtimeRoot && !argument.startsWith('-')) runtimeRoot = argument
    else throw new Error(`Unknown CheckRuntime argument: ${argument}`)
  }
  const runtimeDirectory = resolve(
    runtimeRoot ??
      (process.env.REDENCUT_RUNTIME_ROOT ||
        join('.runtime', `${process.platform}-${process.arch}`)),
  )
  return { runtimeRoot: runtimeDirectory, modelsRoot }
}

async function checkRequestedRuntime({ runtimeRoot, modelsRoot }) {
  const result = await checkRuntime(runtimeRoot)
  if (result.status === 'ready' && modelsRoot)
    result.alignmentOffline = await verifyAlignmentOffline(runtimeRoot, modelsRoot)
  return result
}

async function main() {
  const options = parseCheckArguments(process.argv.slice(2))
  const result = await checkRequestedRuntime(options)
  const { manifest: _manifest, ...summary } = result
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (result.status !== 'ready') process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
