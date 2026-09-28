import { acquireModelInstallLock } from './ModelInstallLock'
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
import { ModelDownloader } from './ModelDownloader'
import { type ModelRegistry, verifyModelFile } from './ModelRegistry'

/** CLI preparation and UI downloads share the same staging, validation and publication. */
export class ModelInstaller {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly downloader = new ModelDownloader(),
  ) {}
  async install(
    model: ModelDefinition,
    {
      signal,
      token,
      source,
      progress = () => {},
      verifying = () => {},
      validateLoad,
    }: {
      signal: AbortSignal
      token?: string
      source?: string
      progress?: (bytes: number) => void
      verifying?: () => void
      validateLoad?: (model: ModelDefinition, path: string, signal: AbortSignal) => Promise<void>
    },
  ): Promise<string> {
    const existing = await this.registry.resolve(model)
    if (existing) return existing
    const { staging } = this.registry.paths(model)
    const lock = join(
      this.registry.modelsRoot,
      '.locks',
      model.capability,
      model.id,
      model.revision,
    )
    const release = await acquireModelInstallLock(lock)
    try {
      if (source) {
        // Legacy markers are not trusted: every imported weight must match pinned integrity.
        for (const file of model.files) {
          signal.throwIfAborted()
          if (!(await verifyModelFile(join(source, file.path), file)))
            throw new Error('integrity-failed')
          const destination = join(staging, file.path)
          await mkdir(dirname(destination), { recursive: true })
          await cp(join(source, file.path), destination, { dereference: true })
        }
      } else {
        await this.downloader.download(model, staging, signal, progress, token, verifying)
      }
      signal.throwIfAborted()
      verifying()
      if (validateLoad) await validateLoad(model, staging, signal)
      signal.throwIfAborted()
      return await this.registry.publish(model)
    } finally {
      await release()
    }
  }
}
