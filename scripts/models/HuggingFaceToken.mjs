import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TOKEN_ENVIRONMENT_KEYS = ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACE_TOKEN']

export async function resolveHuggingFaceToken({ environment = process.env } = {}) {
  for (const key of TOKEN_ENVIRONMENT_KEYS) {
    if (environment[key]?.trim()) return environment[key].trim()
  }
  let candidates
  if (environment.HF_TOKEN_PATH) candidates = [environment.HF_TOKEN_PATH]
  else if (environment.HF_HOME) candidates = [join(environment.HF_HOME, 'token')]
  else
    candidates = [
      join(environment.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'huggingface', 'token'),
    ]
  for (const path of candidates) {
    try {
      const token = (await readFile(path, 'utf8')).trim()
      if (token) return token
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') throw error
    }
  }
  return undefined
}
