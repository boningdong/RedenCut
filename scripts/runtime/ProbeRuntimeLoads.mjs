import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createManagedPythonEnvironment } from './RuntimeEnvironment.mjs'

const execute = promisify(execFile)
const audioProbe = fileURLToPath(new URL('./probes/check_audio_dependencies.py', import.meta.url))

function executableArguments(name) {
  if (name === 'python') return ['-B', '-c', 'import sys; print(sys.version)']
  if (name === 'whisper-cli') return ['--help']
  return ['-version']
}

async function loadExecutable(name, executablePath, runtimeRoot) {
  try {
    await execute(executablePath, executableArguments(name), {
      cwd: runtimeRoot,
      env: createManagedPythonEnvironment(runtimeRoot),
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(`${name} failed to load from ${executablePath}: ${error.message}`)
  }
}

async function createProbeAudio(ffmpeg, audioPath, runtimeRoot, environment) {
  await execute(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.2',
      audioPath,
    ],
    { cwd: runtimeRoot, env: environment, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  )
}

async function probePythonAudioDependencies(runtimeRoot, manifest) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'redencut-runtime-probe-'))
  const audioPath = join(temporaryDirectory, 'probe.wav')
  const environment = createManagedPythonEnvironment(runtimeRoot)
  try {
    await createProbeAudio(
      join(runtimeRoot, manifest.executables.ffmpeg),
      audioPath,
      runtimeRoot,
      environment,
    )
    // Import order can affect native-library loading, so each order gets a fresh process.
    for (const importOrder of ['torchcodec-first', 'av-first']) {
      await execute(
        join(runtimeRoot, manifest.executables.python),
        ['-B', '-I', '-s', '-E', audioProbe, importOrder, audioPath],
        { cwd: runtimeRoot, env: environment, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      )
    }
  } catch (error) {
    throw new Error(`managed Python dependency probe failed: ${error.stderr || error.message}`)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function probeRuntimeLoads(runtimeRoot, manifest) {
  for (const [name, relativePath] of Object.entries(manifest.executables))
    await loadExecutable(name, join(runtimeRoot, relativePath), runtimeRoot)
  if (manifest.executables.python) await probePythonAudioDependencies(runtimeRoot, manifest)
}
