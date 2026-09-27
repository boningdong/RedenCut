import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = '/opt/redencut-runtime'
const manifestPath = join(root, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.runtimeId = `harness-speech-7.1.5-${process.arch}`
manifest.executables.python = 'speech-env/bin/python'
manifest.executables['whisper-cli'] = 'bin/whisper-cli'
manifest.components.push({
  name: 'whisper.cpp',
  version: '1.9.3',
  license: 'MIT',
  sourceUrl: 'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.3.tar.gz',
  sourceSha256: '1650f884effba487025143bd8facd2f9fb40a83b3737a732803c67a8d659d9c0',
})
manifest.components.push({
  name: 'CPython',
  version: '3.11.16',
  license: 'PSF-2.0',
  sourceUrl: 'https://www.python.org/downloads/source/',
})
function inventory(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (path === manifestPath) return []
    return statSync(path).isDirectory()
      ? inventory(path)
      : [
          {
            path: relative(root, path),
            sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
          },
        ]
  })
}
manifest.files = inventory(root)
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
