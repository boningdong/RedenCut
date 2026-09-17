import { modelRuntimeReady } from '../../shared/ModelRuntimeRequirements'
import type { AppPreferencesStore } from '../preferences/AppPreferencesStore'
import { selectWhisperDefinition } from './WhisperModelSelection'
import type { DevelopmentEnvironmentChecker } from '../runtime/DevelopmentEnvironmentChecker'
import type { DevelopmentEnvironment } from '../../shared/developmentEnvironment.types'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
import type {
  ResourceSnapshot,
  ResourceState,
  ResourcePreparation,
  ResourceCapability,
} from '../../shared/resources.types'
import type { HuggingFaceAccessService } from '../speech/huggingface/HuggingFaceAccessService'
import type { ModelRegistry } from './ModelRegistry'
import { ModelDownloader } from './ModelDownloader'
import { resourcePaths } from './resourcePaths'
export class ResourceManager {
  private resources: ResourceState[]
  private development?: DevelopmentEnvironment
  private revision = 0
  private selectedWhisperModelId?: string
  private selecting = false
  private preparing: Promise<ResourceSnapshot> | null = null
  private hydrated: Promise<void> | null = null
  private active: { controller: AbortController; done: Promise<void> } | null = null
  private listeners = new Set<(snapshot: ResourceSnapshot) => void>()
  readonly models: ModelDefinition[]
  constructor(
    models: ModelDefinition[],
    readonly registry: ModelRegistry,
    private readonly downloader = new ModelDownloader(),
    private readonly access?: HuggingFaceAccessService,
    private readonly validateLoad: ((
      model: ModelDefinition,
      path: string,
      signal: AbortSignal,
    ) => Promise<void>) & {
      preflight?: (models: ModelDefinition[], signal: AbortSignal) => Promise<void>
    } = async () => {},
    private readonly environment?: Pick<DevelopmentEnvironmentChecker, 'check'>,
    private readonly preferences?: Pick<AppPreferencesStore, 'read' | 'setWhisperModel'>,
  ) {
    this.models = models.filter((m) => m.capability !== 'transcription-smoke')
    this.selectedWhisperModelId = selectWhisperDefinition(this.models)?.id
    this.resources = this.models.map((m) => ({
      id: m.id,
      capability: m.capability as ResourceCapability,
      status: 'missing',
      downloadedBytes: 0,
      totalBytes: m.files.reduce((n, f) => n + f.size, 0),
    }))
  }
  subscribe(listener: (snapshot: ResourceSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private snapshot(): ResourceSnapshot {
    return {
      revision: this.revision,
      ...(this.development ? { development: this.development } : {}),
      selectedWhisperModelId: this.selectedWhisperModelId,
      whisperModels: this.models.flatMap((m) =>
        m.capability === 'transcription' && m.selection
          ? [{ id: m.id, variant: m.selection.variant, recommended: m.selection.recommended }]
          : [],
      ),
      resources: this.resources.map((r) => ({ ...r })),
      baseReady: this.resources
        .filter((r) => r.capability === 'alignment' || r.id === this.selectedWhisperModelId)
        .every((r) => r.status === 'ready'),
    }
  }
  private emit(): void {
    this.revision++
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
  async read({ refreshEnvironment = true } = {}): Promise<ResourceSnapshot> {
    await this.ensureHydrated()
    if (this.environment && !this.active && (refreshEnvironment || !this.development)) {
      this.development = await this.environment.check((state) => {
        this.development = state
        this.emit()
      })
      this.emit()
    }
    if (!this.active) {
      let changed = false
      for (const model of this.models) {
        const state = this.resources.find((r) => r.id === model.id)!
        if (state.status === 'ready' && !(await this.registry.resolve(model))) {
          state.status = 'missing'
          state.downloadedBytes = 0
          changed = true
        }
      }
      if (changed) this.emit()
    }
    return this.snapshot()
  }
  private ensureHydrated(): Promise<void> {
    return (this.hydrated ??= this.hydrate())
  }
  private async hydrate(): Promise<void> {
    const preferences = await this.preferences?.read()
    this.selectedWhisperModelId = selectWhisperDefinition(
      this.models,
      preferences?.whisperModelId,
    )?.id
    for (const model of this.models) {
      const state = this.resources.find((r) => r.id === model.id)!
      if (await this.registry.resolve(model)) {
        state.status = 'ready'
        state.downloadedBytes = state.totalBytes!
        continue
      }
      const { staging } = resourcePaths(this.registry.root, model)
      for (const file of model.files) {
        try {
          state.downloadedBytes += Math.min((await stat(join(staging, file.path))).size, file.size)
        } catch {
          /* no partial */
        }
      }
      if (state.downloadedBytes) state.status = 'paused'
    }
    this.emit()
  }
  async selectWhisperModel(id: string): Promise<ResourceSnapshot> {
    if (this.selecting || this.preparing || this.active) throw new Error('resources-busy')
    if (!this.models.some((m) => m.id === id && m.capability === 'transcription'))
      throw new Error('unknown-whisper-model')
    this.selecting = true
    try {
      await this.ensureHydrated()
      await this.preferences?.setWhisperModel(id)
      this.selectedWhisperModelId = id
      this.emit()
      return this.snapshot()
    } finally {
      this.selecting = false
    }
  }

  async resolveWhisperModel(
    id = this.selectedWhisperModelId,
  ): Promise<{ model: ModelDefinition; path: string } | null> {
    const model = this.models.find((m) => m.id === id && m.capability === 'transcription')
    if (!model) return null
    const directory = await this.registry.resolve(model)
    return directory ? { model, path: join(directory, model.files[0].path) } : null
  }

  prepare(target: ResourcePreparation): Promise<ResourceSnapshot> {
    if (this.selecting) return Promise.reject(new Error('resources-busy'))
    if (this.preparing) return this.preparing
    this.preparing = this.start(target).finally(() => {
      this.preparing = null
    })
    return this.preparing
  }
  private async start(target: ResourcePreparation): Promise<ResourceSnapshot> {
    await this.read({ refreshEnvironment: false })
    if (this.active) return this.snapshot()
    if (target === 'diarization' && !this.snapshot().baseReady)
      throw new Error('base-resources-required')
    if (
      typeof target === 'object' &&
      !this.models.some((m) => m.id === target.modelId && m.capability === 'transcription')
    )
      throw new Error('unknown-whisper-model')
    const selected = this.models.filter(
      (m) =>
        (typeof target === 'object'
          ? m.id === target.modelId
          : target === 'base'
            ? m.capability === 'alignment' || m.id === this.selectedWhisperModelId
            : m.capability === target) &&
        this.resources.find((r) => r.id === m.id)?.status !== 'ready',
    )
    if (!selected.length) return this.snapshot()
    if (
      selected.some(
        (model) => !modelRuntimeReady(this.development, model.capability as ResourceCapability),
      )
    ) {
      for (const model of selected) {
        const state = this.resources.find((resource) => resource.id === model.id)!
        state.status = 'failed'
        state.error = 'runtime-unavailable'
      }
      this.emit()
      return this.snapshot()
    }
    const token = target === 'diarization' ? await this.access?.downloadToken() : undefined
    if (target === 'diarization' && !token) throw new Error('access-denied')
    const controller = new AbortController()
    const done = this.run(selected, controller.signal, token).finally(() => {
      this.active = null
    })
    this.active = { controller, done }
    return this.snapshot()
  }
  private async run(models: ModelDefinition[], signal: AbortSignal, token?: string): Promise<void> {
    for (const model of models) {
      const state = this.resources.find((r) => r.id === model.id)!
      if (state.status !== 'ready') {
        state.status = 'verifying'
        delete state.error
      }
    }
    this.emit()
    try {
      await this.validateLoad.preflight?.(models, signal)
    } catch {
      for (const model of models) {
        const state = this.resources.find((r) => r.id === model.id)!
        if (state.status !== 'ready') {
          state.status = signal.aborted ? 'paused' : 'failed'
          state.error = 'runtime-unavailable'
        }
      }
      this.emit()
      return
    }
    for (const model of models) {
      const state = this.resources.find((r) => r.id === model.id)!
      try {
        signal.throwIfAborted()
        if (await this.registry.resolve(model)) {
          state.status = 'ready'
          this.emit()
          continue
        }
        state.status = 'downloading'
        delete state.error
        this.emit()
        let lastProgress = 0
        await this.downloader.download(
          model,
          resourcePaths(this.registry.root, model).staging,
          signal,
          (bytes) => {
            state.downloadedBytes = bytes
            state.status = 'downloading'
            if (Date.now() - lastProgress >= 100 || bytes === state.totalBytes) {
              lastProgress = Date.now()
              this.emit()
            }
          },
          token,
          () => {
            state.status = 'verifying'
            this.emit()
          },
        )
        signal.throwIfAborted()
        state.status = 'verifying'
        this.emit()
        await this.validateLoad(model, resourcePaths(this.registry.root, model).staging, signal)
        signal.throwIfAborted()
        await this.registry.publish(model)
        state.status = 'ready'
        this.emit()
      } catch (error) {
        state.status = signal.aborted ? 'paused' : 'failed'
        if (!signal.aborted) {
          const reason = error instanceof Error ? error.message : ''
          state.error = ['access-denied', 'integrity-failed'].includes(reason)
            ? reason
            : 'download-failed'
          if (reason === 'access-denied') this.access?.revoke()
        }
        for (const queued of this.resources)
          if (queued.id !== state.id && queued.status === 'verifying')
            queued.status = queued.downloadedBytes ? 'paused' : 'missing'
        this.emit()
        return
      }
    }
  }
  async cancel(): Promise<ResourceSnapshot> {
    await this.preparing?.catch(() => {})
    this.active?.controller.abort()
    await this.active?.done
    return this.read({ refreshEnvironment: false })
  }
  async getModelPaths(): Promise<Record<string, string>> {
    const paths: Record<string, string> = {}
    for (const model of this.models) {
      const path = await this.registry.resolve(model)
      if (path) paths[model.id] = path
    }
    return paths
  }
}
