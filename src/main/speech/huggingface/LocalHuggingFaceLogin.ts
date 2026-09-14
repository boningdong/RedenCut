import { isHuggingFaceToken, MAX_HUGGING_FACE_TOKEN_LENGTH } from './tokenFormat'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LocalModelLoginSnapshot } from '../../../shared/modelAccess.types'
/** Uses only the active Hugging Face credential locations, never scans caches or other accounts. */
export class LocalHuggingFaceLogin {
  constructor(
    private env: NodeJS.ProcessEnv = process.env,
    private home = homedir(),
  ) {}
  async read(): Promise<string | null> {
    const configured = this.env.HF_TOKEN || this.env.HUGGING_FACE_HUB_TOKEN
    if (configured) return this.clean(configured)
    const root =
      this.env.HF_HOME || join(this.env.XDG_CACHE_HOME || join(this.home, '.cache'), 'huggingface')
    const path = this.env.HF_TOKEN_PATH || join(root, 'token')
    try {
      const file = await stat(path)
      if (!file.isFile() || file.size > MAX_HUGGING_FACE_TOKEN_LENGTH + 2)
        throw new Error('local-login-unavailable')
      return this.clean(await readFile(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      // Credential errors and paths never leave the secret-reading boundary.
      // eslint-disable-next-line preserve-caught-error -- Credential-reader errors must not retain secret values or paths.
      throw new Error('local-login-unavailable')
    }
  }
  private clean(value: string): string | null {
    const token = value.trim()
    if (!token) return null
    if (!isHuggingFaceToken(token)) throw new Error('local-login-unavailable')
    return token
  }
  async detect(): Promise<LocalModelLoginSnapshot> {
    try {
      return { status: (await this.read()) ? 'found' : 'missing' }
    } catch {
      return { status: 'unavailable' }
    }
  }
}
