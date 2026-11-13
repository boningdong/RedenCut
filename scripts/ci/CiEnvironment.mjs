import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyPythonDependencyInputs } from '../runtime/RuntimeLock.mjs'

const root = resolve(import.meta.dirname, '../..')

export async function ciEnvironment(action) {
  if (action === 'versions') {
    const lock = JSON.parse(await readFile(resolve(root, 'runtime/runtime-lock.json'), 'utf8'))
    await verifyPythonDependencyInputs(lock, resolve(root, 'speech-worker'))
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    await appendFile(process.env.GITHUB_OUTPUT, `uv=${lock.buildTools.uv.version}\n`)
  } else if (action === 'prepare-docker') {
    await mkdir(resolve(root, '.runtime/ci-models'), { recursive: true })
    const artifacts = resolve(root, '.harness-runs/container')
    await mkdir(artifacts, { recursive: true })
    // The container runs as node (uid 1000); hosted runners may use another uid.
    await chmod(artifacts, 0o777)
  } else if (action === 'collect-docker') {
    if (process.env.GITHUB_ACTIONS !== 'true')
      throw new Error('Artifact ownership collection is only for GitHub runners')
    const result = spawnSync(
      'sudo',
      [
        'chown',
        '-R',
        `${process.getuid()}:${process.getgid()}`,
        resolve(root, '.harness-runs/container'),
      ],
      { stdio: 'inherit' },
    )
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('Could not collect container artifacts')
  } else if (action === 'require-model-token') {
    if (!process.env.HF_TOKEN)
      throw new Error(
        'Configure HF_TOKEN with access to the bundled diarization model before releasing',
      )
  } else
    throw new Error(
      'Usage: node scripts/ci/CiEnvironment.mjs {versions|prepare-docker|collect-docker|require-model-token}',
    )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.length !== 3) throw new Error('Exactly one CI environment action is required')
  await ciEnvironment(process.argv[2])
}
