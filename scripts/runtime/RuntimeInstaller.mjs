import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { checkRuntime } from './CheckRuntime.mjs'
import { validateRuntimeDirectory } from './RuntimeVerifier.mjs'

async function requireReadyRuntime(root) {
  const result = await checkRuntime(root)
  if (result.status !== 'ready') {
    throw new Error(`Runtime readiness probe failed (${result.status}): ${result.message}`)
  }
}

export async function installRuntimeGeneration({ bundleRoot, destinationRoot }) {
  await validateRuntimeDirectory(bundleRoot)

  const parent = dirname(destinationRoot)
  const stagingRoot = join(parent, `.${basename(destinationRoot)}.staging-${randomUUID()}`)
  const previousRoot = join(parent, `.${basename(destinationRoot)}.previous-${randomUUID()}`)
  await mkdir(parent, { recursive: true })

  let movedPrevious = false
  let selectedNew = false
  try {
    await cp(bundleRoot, stagingRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    })
    await validateRuntimeDirectory(stagingRoot)
    await requireReadyRuntime(stagingRoot)
    try {
      await rename(destinationRoot, previousRoot)
      movedPrevious = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await rename(stagingRoot, destinationRoot)
    selectedNew = true
    await requireReadyRuntime(destinationRoot)
    if (movedPrevious) await rm(previousRoot, { recursive: true })
    return JSON.parse(await readFile(join(destinationRoot, 'manifest.json'), 'utf8'))
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true })
    if (selectedNew) await rm(destinationRoot, { recursive: true, force: true })
    if (movedPrevious) {
      try {
        await rename(previousRoot, destinationRoot)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Runtime installation failed and rollback failed',
        )
      }
    }
    throw error
  }
}
