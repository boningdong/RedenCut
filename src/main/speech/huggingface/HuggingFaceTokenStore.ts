import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
export interface SecretProtection {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}
export class HuggingFaceTokenStore {
  constructor(
    private readonly path: string,
    private readonly protection: SecretProtection,
  ) {}
  private available(): void {
    if (
      !this.protection.isEncryptionAvailable() ||
      this.protection.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new Error('storage-unavailable')
  }
  async read(): Promise<string | null> {
    this.available()
    try {
      return this.protection.decryptString(await readFile(this.path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      // eslint-disable-next-line preserve-caught-error -- Secret-provider exceptions may contain credentials; never retain their cause.
      throw new Error('storage-unavailable')
    }
  }
  async save(token: string): Promise<void> {
    this.available()
    try {
      const encrypted = this.protection.encryptString(token)
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(this.path + '.tmp', encrypted, { mode: 0o600 })
      await rename(this.path + '.tmp', this.path)
    } catch {
      throw new Error('storage-unavailable')
    }
  }
  async clear(): Promise<void> {
    await rm(this.path, { force: true })
    await rm(this.path + '.tmp', { force: true })
  }
}
