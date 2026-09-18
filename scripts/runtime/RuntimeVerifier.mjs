import { access, constants, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sha256File } from './RuntimeIntegrity.mjs'
import { validateRuntimeManifest } from './RuntimeManifest.mjs'
import { assertNoSymlinkEscape, resolveRuntimePath } from './RuntimePaths.mjs'

async function readManifest(root) {
  let serialized
  try {
    serialized = await readFile(join(root, 'manifest.json'), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw new Error(`Missing runtime manifest: ${join(root, 'manifest.json')}`)
    throw error
  }
  try {
    return validateRuntimeManifest(JSON.parse(serialized))
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`Invalid runtime manifest JSON: ${error.message}`)
    throw error
  }
}

export async function validateRuntimeDirectory(root) {
  const manifest = await readManifest(root)
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]))

  for (const [name, runtimeRelativePath] of Object.entries(manifest.executables)) {
    if (!filesByPath.has(runtimeRelativePath)) {
      throw new Error(`Missing ${name} file record for ${runtimeRelativePath}`)
    }
    const executablePath = resolveRuntimePath(root, runtimeRelativePath)
    try {
      await access(executablePath, constants.F_OK)
      await assertNoSymlinkEscape(root, runtimeRelativePath)
    } catch (error) {
      if (error?.code === 'ENOENT')
        throw new Error(`Missing runtime executable: ${runtimeRelativePath}`)
      throw error
    }
  }

  for (const file of manifest.files) {
    let absolutePath
    try {
      absolutePath = await assertNoSymlinkEscape(root, file.path)
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Missing runtime file: ${file.path}`)
      throw error
    }
    const actualSha256 = await sha256File(absolutePath)
    if (actualSha256 !== file.sha256) {
      throw new Error(
        `Runtime integrity failure for ${file.path}: expected ${file.sha256}, received ${actualSha256}`,
      )
    }
  }
  return manifest
}
