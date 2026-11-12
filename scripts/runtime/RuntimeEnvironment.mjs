import { join } from 'node:path'

const removedVariables = ['PYTHONHOME', 'PYTHONUSERBASE', 'PYTHONPATH']

export function createSanitizedRuntimeEnvironment(sourceEnvironment = process.env) {
  const environment = { ...sourceEnvironment }
  for (const variable of removedVariables) delete environment[variable]
  for (const variable of Object.keys(environment)) {
    if (/^(?:LD_|DYLD_)/.test(variable)) delete environment[variable]
  }
  return environment
}

export function createManagedPythonEnvironment(runtimeRoot, sourceEnvironment = process.env) {
  const environment = createSanitizedRuntimeEnvironment(sourceEnvironment)
  environment.PYTHONNOUSERSITE = '1'
  environment.PYTHONDONTWRITEBYTECODE = '1'
  environment.PATH = join(runtimeRoot, 'bin')
  environment.NLTK_DATA = join(runtimeRoot, 'nltk_data')
  return environment
}

/**
 * Developer-only environment for offline alignment checks, not application inference.
 * The caller supplies a fresh temporary directory and separately blocks network access.
 */
export function createOfflineAlignmentCheckEnvironment(
  runtimeRoot,
  temporaryDirectory,
  sourceEnvironment = process.env,
) {
  const environment = createManagedPythonEnvironment(runtimeRoot, sourceEnvironment)
  for (const key of Object.keys(environment)) {
    if (
      /^(HF_|HUGGINGFACE_|TRANSFORMERS_|PYTORCH_)/.test(key) ||
      /TOKEN|SECRET|PASSWORD/i.test(key)
    )
      delete environment[key]
  }
  return {
    ...environment,
    HOME: temporaryDirectory,
    HF_HOME: join(temporaryDirectory, 'hf'),
    XDG_CACHE_HOME: join(temporaryDirectory, 'cache'),
    TORCH_HOME: join(temporaryDirectory, 'torch'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
    MPLCONFIGDIR: join(temporaryDirectory, 'matplotlib'),
  }
}
