import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readRuntimeLock } from '../../../../scripts/runtime/RuntimeLock.mjs'
import { requireBuildDirectory } from '../LinuxRuntimeBuild.mjs'

export async function writeAudioManifest({
  runtimeRoot = process.env.REDENCUT_RUNTIME_ROOT,
  lock,
  pulseVersion,
} = {}) {
  const root = requireBuildDirectory(runtimeRoot, 'REDENCUT_RUNTIME_ROOT')
  const definition = lock ?? (await readRuntimeLock({ platform: 'linux' }))
  const manifestPath = join(root, 'manifest.json')
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
  const components = ['ffmpeg', 'lame'].map((name) => {
    const source = definition.sources[name]
    return {
      name,
      version: source.version,
      license: source.license,
      sourceUrl: source.url,
      sourceSha256: source.sha256,
    }
  })
  components.unshift({
    name: 'libpulse-system-test-dependency',
    version:
      pulseVersion ??
      execFileSync('dpkg-query', ['-W', '-f=${Version}', 'libpulse0'], { encoding: 'utf8' }),
    license: 'LGPL-2.1-or-later',
    sourceUrl: 'https://sources.debian.org/src/pulseaudio/',
  })
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        runtimeId: `harness-audio-${definition.sources.ffmpeg.version}-${process.arch}`,
        platform: 'linux',
        arch: process.arch,
        executables: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe' },
        components,
        files: inventory(root),
      },
      null,
      2,
    ) + '\n',
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await writeAudioManifest()
