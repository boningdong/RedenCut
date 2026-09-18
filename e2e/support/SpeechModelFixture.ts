import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

/** Real cached models, mounted read-only; never synthesize readiness or download during E2E. */
export function prepareSpeechModelFixture(runDirectory: string): void {
  if (process.platform !== 'linux' || !existsSync('/.dockerenv') || !existsSync('/test-models')) {
    throw new Error(
      'SPEECH_MODEL_FIXTURE_REQUIRED: mount an existing app models directory read-only at /test-models in the speech harness',
    )
  }
  const userData = join(runDirectory, 'user-data')
  mkdirSync(userData, { recursive: true })
  const destination = join(userData, 'models')
  if (!existsSync(destination)) symlinkSync('/test-models', destination, 'dir')
}
