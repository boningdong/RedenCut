import { access, mkdir, open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { sha256File } from './RuntimeIntegrity.mjs'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function downloadRuntimeSource(source, downloadsRoot, onProgress = () => {}) {
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
