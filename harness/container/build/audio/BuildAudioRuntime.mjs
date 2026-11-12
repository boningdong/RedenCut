import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readRuntimeLock } from '../../../../scripts/runtime/RuntimeLock.mjs'
import {
  prepareRuntimeSource,
  requireBuildDirectory,
  runBuildCommand,
} from '../LinuxRuntimeBuild.mjs'

const compilationRecipe = fileURLToPath(new URL('./BuildAudioRuntime.sh', import.meta.url))

export async function buildAudioRuntime({
  runtimeRoot = process.env.REDENCUT_RUNTIME_ROOT,
  lock,
} = {}) {
  requireBuildDirectory(runtimeRoot, 'REDENCUT_RUNTIME_ROOT')
  const definition = lock ?? (await readRuntimeLock({ platform: 'linux' }))
  const workDirectory = await mkdtemp(join(tmpdir(), 'redencut-audio-build-'))
  try {
    await mkdir(join(runtimeRoot, 'licenses'), { recursive: true })
    const lameDirectory = await prepareRuntimeSource(
      definition.sources.lame,
      workDirectory,
      runtimeRoot,
    )
    const ffmpegDirectory = await prepareRuntimeSource(
      definition.sources.ffmpeg,
      workDirectory,
      runtimeRoot,
    )
    await runBuildCommand('sh', [compilationRecipe, runtimeRoot, lameDirectory, ffmpegDirectory])
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await buildAudioRuntime()
