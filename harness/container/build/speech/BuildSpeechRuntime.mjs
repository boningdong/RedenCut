import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  readRuntimeLock,
  verifyPythonDependencyInputs,
} from '../../../../scripts/runtime/RuntimeLock.mjs'
import { downloadRuntimeSource } from '../../../../scripts/runtime/DownloadRuntimeSource.mjs'
import { stageNltkData } from '../../../../scripts/runtime/NltkData.mjs'
import {
  prepareRuntimeSource,
  requireBuildDirectory,
  runBuildCommand,
} from '../LinuxRuntimeBuild.mjs'

const whisperRecipe = fileURLToPath(new URL('./BuildWhisperRuntime.sh', import.meta.url))

function pythonBuildEnvironment(runtimeRoot) {
  return {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(runtimeRoot, 'python'),
    UV_PROJECT_ENVIRONMENT: join(runtimeRoot, 'speech-env'),
    UV_NO_BINARY_PACKAGE: 'av',
    PKG_CONFIG_PATH: join(runtimeRoot, 'lib/pkgconfig'),
    LDFLAGS: `-Wl,-rpath,${join(runtimeRoot, 'lib')}`,
  }
}

async function syncPythonEnvironment(lock, runtimeRoot, workerRoot, { installProject }) {
  const arguments_ = ['sync', '--python', lock.sources.python.version, '--frozen', '--no-dev']
  if (!installProject) arguments_.push('--no-install-project')
  await runBuildCommand('uv', arguments_, {
    cwd: workerRoot,
    env: pythonBuildEnvironment(runtimeRoot),
  })
}

export async function prepareSpeechDependencies({ runtimeRoot, workerRoot, lock }) {
  await verifyPythonDependencyInputs(lock, workerRoot)
  await runBuildCommand('python3', [
    '-m',
    'pip',
    'install',
    '--no-cache-dir',
    '--break-system-packages',
    `uv==${lock.buildTools.uv.version}`,
  ])
  await runBuildCommand('uv', ['python', 'install', lock.sources.python.version], {
    env: pythonBuildEnvironment(runtimeRoot),
  })
  await syncPythonEnvironment(lock, runtimeRoot, workerRoot, { installProject: false })
}

export async function buildWhisperRuntime({ runtimeRoot, lock }) {
  const workDirectory = await mkdtemp(join(tmpdir(), 'redencut-whisper-build-'))
  try {
    const sourceDirectory = await prepareRuntimeSource(
      lock.sources.whisperCpp,
      workDirectory,
      runtimeRoot,
    )
    await runBuildCommand('sh', [
      whisperRecipe,
      runtimeRoot,
      sourceDirectory,
      join(workDirectory, 'build'),
    ])
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

export async function completeSpeechRuntime({ runtimeRoot, workerRoot, lock }) {
  await verifyPythonDependencyInputs(lock, workerRoot)
  const workDirectory = await mkdtemp(join(tmpdir(), 'redencut-speech-build-'))
  try {
    await syncPythonEnvironment(lock, runtimeRoot, workerRoot, { installProject: true })
    const archive = await downloadRuntimeSource(
      lock.data.punktTab,
      join(workDirectory, 'downloads'),
    )
    await stageNltkData(archive, runtimeRoot, lock.data.punktTab)
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

async function main() {
  const options = {
    runtimeRoot: requireBuildDirectory(process.env.REDENCUT_RUNTIME_ROOT, 'REDENCUT_RUNTIME_ROOT'),
    workerRoot: requireBuildDirectory(
      process.env.REDENCUT_SPEECH_WORKER_ROOT,
      'REDENCUT_SPEECH_WORKER_ROOT',
    ),
    lock: await readRuntimeLock({ platform: 'linux' }),
  }
  if (process.argv[2] === 'dependencies') await prepareSpeechDependencies(options)
  else if (process.argv[2] === 'native-tools') await buildWhisperRuntime(options)
  else if (process.argv[2] === 'complete') await completeSpeechRuntime(options)
  else throw new Error('Usage: BuildSpeechRuntime.mjs {native-tools|dependencies|complete}')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
