import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sha256File } from './RuntimeIntegrity.mjs'

export async function updatePythonDependencyHashes(root = resolve(import.meta.dirname, '../..')) {
  const path = join(root, 'runtime/runtime-lock.json')
  const lock = JSON.parse(await readFile(path, 'utf8'))
  lock.pythonDependencies = {
    pyprojectSha256: await sha256File(join(root, 'speech-worker/pyproject.toml')),
    uvLockSha256: await sha256File(join(root, 'speech-worker/uv.lock')),
  }
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  await updatePythonDependencyHashes()
