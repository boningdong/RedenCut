import { isHuggingFaceToken } from './tokenFormat'
import type { LocalHuggingFaceLogin } from './LocalHuggingFaceLogin'
import type { LocalModelLoginSnapshot } from '../../../shared/modelAccess.types'
import type { ModelDefinition } from '../../../shared/modelManifest.schema'
import type { ModelAccessSnapshot } from '../../../shared/modelAccess.types'
import { fetchModel, modelFileUrl } from '../../resources/ModelDownloader'
import type { HuggingFaceTokenStore } from './HuggingFaceTokenStore'
export class HuggingFaceAccessService {
  private snapshot: ModelAccessSnapshot = { status: 'unchecked', hasToken: false }
  private listeners = new Set<(snapshot: ModelAccessSnapshot) => void>()
  private epoch = 0
  private clearing: Promise<ModelAccessSnapshot> | null = null
  private checking: Promise<ModelAccessSnapshot> | null = null
  constructor(
    private readonly store: HuggingFaceTokenStore,
    private readonly model: ModelDefinition,
    private readonly fetcher: typeof fetch = fetch,
    private readonly localLogin?: LocalHuggingFaceLogin,
  ) {}
  get conditionsUrl(): string {
    return `https://huggingface.co/${this.model.repository}`
  }
  subscribe(listener: (snapshot: ModelAccessSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private emit(): ModelAccessSnapshot {
    const s = { ...this.snapshot }
    for (const listener of this.listeners) listener(s)
    return s
  }
  async read(): Promise<ModelAccessSnapshot> {
    const epoch = this.epoch
    try {
      const hasToken = !!(await this.store.read())
      if (epoch === this.epoch) this.snapshot.hasToken = hasToken
    } catch {
      if (epoch === this.epoch) this.snapshot = { status: 'storage-unavailable', hasToken: false }
    }
    return { ...this.snapshot }
  }
  detectLocal(): Promise<LocalModelLoginSnapshot> {
    return this.localLogin?.detect() ?? Promise.resolve({ status: 'unsupported' })
  }
  verifyLocal(): Promise<ModelAccessSnapshot> {
    if (!this.localLogin) return Promise.reject(new Error('local-login-unsupported'))
    return this.startVerification(() => this.localLogin!.read())
  }
  verify(token?: string): Promise<ModelAccessSnapshot> {
    return this.startVerification(async () => token?.trim() || (await this.store.read()))
  }
  private startVerification(readToken: () => Promise<string | null>): Promise<ModelAccessSnapshot> {
    if (this.clearing) return this.clearing.then(() => this.startVerification(readToken))
    if (this.checking) return this.checking
    this.epoch++
    this.checking = this.check(readToken).finally(() => {
      this.checking = null
    })
    return this.checking
  }
  private async check(readToken: () => Promise<string | null>): Promise<ModelAccessSnapshot> {
    this.snapshot.status = 'checking'
    this.emit()
    try {
      const value = await readToken()
      if (!value || !isHuggingFaceToken(value)) {
        this.snapshot.status = 'invalid-token'
        return this.emit()
      }
      for (const file of this.model.files) {
        const response = await fetchModel(
          modelFileUrl(this.model, file.path),
          {
            method: 'HEAD',
            headers: { authorization: `Bearer ${value}` },
            signal: AbortSignal.timeout(30000),
          },
          this.fetcher,
        )
        if (!response.ok) {
          this.snapshot.status =
            response.status === 401
              ? 'invalid-token'
              : response.status === 403
                ? 'access-denied'
                : 'network-error'
          return this.emit()
        }
      }
      await this.store.save(value)
      this.snapshot = { status: 'granted', hasToken: true }
    } catch (error) {
      this.snapshot.status =
        error instanceof Error && error.message === 'storage-unavailable'
          ? 'storage-unavailable'
          : 'network-error'
    }
    return this.emit()
  }
  clear(): Promise<ModelAccessSnapshot> {
    if (this.clearing) return this.clearing
    this.epoch++
    this.clearing = (async () => {
      if (this.checking) await this.checking
      await this.store.clear()
      this.snapshot = { status: 'unchecked', hasToken: false }
      return this.emit()
    })().finally(() => {
      this.clearing = null
    })
    return this.clearing
  }
  async downloadToken(): Promise<string> {
    const epoch = this.epoch
    if (this.clearing || this.snapshot.status !== 'granted') throw new Error('access-denied')
    const token = await this.store.read()
    if (this.clearing || epoch !== this.epoch || this.snapshot.status !== 'granted' || !token)
      throw new Error('access-denied')
    return token
  }
  revoke(): void {
    this.epoch++
    this.snapshot.status = 'access-denied'
    this.emit()
  }
}
