import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createOfflineAlignmentCheckEnvironment } from './RuntimeEnvironment.mjs'

const execute = promisify(execFile)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const alignmentProbe = fileURLToPath(
  new URL('./probes/check_alignment_offline.py', import.meta.url),
)

/** Run actual EN/ZH model inference with empty caches and network access rejected. */
export async function verifyAlignmentOffline(runtimeRoot, modelsRoot) {
  const manifest = JSON.parse(await readFile(join(runtimeRoot, 'manifest.json'), 'utf8'))
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'redencut-alignment-offline-'))
  try {
    const env = createOfflineAlignmentCheckEnvironment(runtimeRoot, temporaryDirectory)
    env.PYTHONPATH = join(repository, 'speech-worker/src')
    const { stdout } = await execute(
      join(runtimeRoot, manifest.executables.python),
      [
        '-B',
        alignmentProbe,
        '--manifest',
        join(repository, 'speech-worker/models.json'),
        '--models-root',
        resolve(modelsRoot),
      ],
      { cwd: temporaryDirectory, env, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    )
    return JSON.parse(stdout.trim().split('\n').at(-1))
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
