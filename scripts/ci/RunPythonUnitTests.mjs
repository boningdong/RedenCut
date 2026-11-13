import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function runPythonUnitTests({
  root = resolve(import.meta.dirname, '../..'),
  environment = process.env,
  python = environment.REDENCUT_TEST_PYTHON || 'python3',
  run = spawnSync,
} = {}) {
  const version = run(python, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {
    encoding: 'utf8',
  })
  if (version.error || version.status !== 0 || version.stdout.trim() !== '3.11')
    throw new Error(
      'Python unit tests require a prepared Python 3.11 environment. Sync the worker unit dependency group and set REDENCUT_TEST_PYTHON to its interpreter.',
    )
  const env = {
    ...environment,
    PYTHONPATH: resolve(root, 'speech-worker/src'),
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  }
  delete env.PYTHONHOME
  const result = run(
    python,
    ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'],
    {
      cwd: resolve(root, 'speech-worker'),
      env,
      stdio: 'inherit',
    },
  )
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Python unit tests terminated by ${result.signal}`)
  return result.status ?? 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = runPythonUnitTests()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
