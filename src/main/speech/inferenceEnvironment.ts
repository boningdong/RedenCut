import { runtimeEnvironment } from '../runtime/RuntimeEnvironment'
export function offlineEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = runtimeEnvironment(input)
  for (const key of [
    'HF_TOKEN',
    'HUGGING_FACE_HUB_TOKEN',
    'HUGGINGFACE_TOKEN',
    'HF_TOKEN_PATH',
    'PYTHONHOME',
    'PYTHONUSERBASE',
  ])
    delete env[key]
  return {
    ...env,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
  }
}
