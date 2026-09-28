import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import type { DiagnosticBundleManifest } from '../../shared/DiagnosticBundleTypes'

/** Streams a fixed snapshot into a same-directory temporary file before publication. */
export async function saveDiagnosticBundle(
  root: string,
  manifest: DiagnosticBundleManifest,
  destination: string,
): Promise<void> {
  const temporary = join(dirname(destination), `.redencut-diagnostic-${randomUUID()}.tmp`)
  const zip = new ZipFile()
  const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
  const completed = pipeline(zip.outputStream, output)
  zip.on('error', (error: Error) => (zip.outputStream as Readable).destroy(error))
  try {
    zip.addFile(join(root, 'manifest.json'), 'manifest.json', { compressionLevel: 1 })
    for (const file of manifest.files)
      zip.addFile(join(root, file.path), file.path, { compressionLevel: 1 })
    zip.end()
    await completed
    await rename(temporary, destination)
  } catch (error) {
    ;(zip.outputStream as Readable).destroy()
    output.destroy()
    await completed.catch(() => {})
    throw error
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
