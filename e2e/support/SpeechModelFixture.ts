import { existsSync } from 'node:fs'

/** Real models mounted read-only; never synthesize readiness or download during E2E. */
export function prepareSpeechModelFixture(): void {
  if (
    process.platform !== 'linux' ||
    !existsSync('/.dockerenv') ||
    process.env.REDENCUT_MODELS_PATH !== '/models' ||
    !existsSync('/models')
  ) {
    throw new Error(
      'SPEECH_MODEL_FIXTURE_REQUIRED: mount an existing app models directory read-only at /models in the speech harness',
    )
  }
}
