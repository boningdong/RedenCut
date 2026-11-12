import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readRuntimeLock } from '../../../../scripts/runtime/RuntimeLock.mjs'
import { requireBuildDirectory } from '../LinuxRuntimeBuild.mjs'

export async function writeSpeechManifest({
  runtimeRoot = process.env.REDENCUT_RUNTIME_ROOT,
  lock,
} = {}) {
  const root = requireBuildDirectory(runtimeRoot, 'REDENCUT_RUNTIME_ROOT')
  const definition = lock ?? (await readRuntimeLock({ platform: 'linux' }))
  const manifestPath = join(root, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.runtimeId = `harness-speech-${definition.sources.ffmpeg.version}-${process.arch}`
  manifest.executables.python = 'speech-env/bin/python'
  manifest.executables['whisper-cli'] = 'bin/whisper-cli'
  for (const [name, source] of [
    ['whisper.cpp', definition.sources.whisperCpp],
    ['CPython', definition.sources.python],
    ['punktTab', definition.data.punktTab],
  ]) {
    manifest.components.push({
      name,
      version: source.version,
      license: source.license,
      sourceUrl: source.url,
      sourceSha256: source.sha256,
    })
  }
  function inventory(directory) {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name)
      if (path === manifestPath) return []
      return statSync(path).isDirectory()
        ? inventory(path)
        : [
            {
              path: path.slice(root.length + 1),
              sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
            },
          ]
    })
  }
  manifest.files = inventory(root)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await writeSpeechManifest()
