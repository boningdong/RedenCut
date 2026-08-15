import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import type { ProjectOpenResult } from '../../shared/import.types'
import type { ProjectFile } from '../../shared/project.types'
import type { AudioSourceId } from '../../shared/project.types'
import { AudioSourceCacheStore } from '../audio/cache/AudioSourceCacheStore'
import { FfmpegAudioSourceCacheBuilder } from '../audio/import/FfmpegAudioSourceCacheBuilder'
import { ProjectWorkspace } from './ProjectWorkspace'
import { ProjectPathResolver } from './ProjectPathResolver'

export class WorkspaceController {
  private current: ProjectWorkspace | null = null

  constructor(private readonly cacheBuilder = new FfmpegAudioSourceCacheBuilder()) {}

  async initialize(temporaryParent: string): Promise<ProjectOpenResult> {
    if (!this.current)
      this.current = await ProjectWorkspace.initialize(join(temporaryParent, 'podcut'))
    return this.describe()
  }

  get workspace(): ProjectWorkspace {
    if (!this.current) throw new Error('Project workspace has not been initialized')
    return this.current
  }

  async open(root: string): Promise<ProjectOpenResult> {
    const candidate = await ProjectWorkspace.open(root)
    const sources = await this.descriptors(candidate)
    this.current = candidate
    return candidate.toOpenResult(sources)
  }

  async save(project: ProjectFile): Promise<ProjectOpenResult> {
    await this.workspace.save(project)
    return this.describe()
  }

  async saveAs(destination: string, project: ProjectFile): Promise<ProjectOpenResult> {
    await this.workspace.saveAs(destination, project, async (candidate) => {
      await this.descriptors(candidate)
    })
    return this.describe()
  }

  async describe(): Promise<ProjectOpenResult> {
    return this.workspace.toOpenResult(await this.descriptors(this.workspace))
  }

  async resolveOriginal(audioSourceId: AudioSourceId): Promise<string> {
    const source = this.workspace.project.audioSources.find(
      (candidate) => candidate.id === audioSourceId,
    )
    if (!source) throw new Error(`Unknown audio source: ${audioSourceId}`)
    const path = await resolveOriginal(this.workspace, source)
    await verifyFingerprint(path, source.fingerprint)
    return path
  }

  private async descriptors(workspace: ProjectWorkspace): Promise<ProjectOpenResult['sources']> {
    const store = new AudioSourceCacheStore(workspace.root)
    const result: ProjectOpenResult['sources'] = []
    for (const source of workspace.project.audioSources) {
      const original = await resolveOriginal(workspace, source)
      await verifyFingerprint(original, source.fingerprint)
      let manifest = await store.validate(source)
      if (!manifest) {
        manifest = await this.cacheBuilder.build(
          {
            projectRoot: workspace.root,
            stagingRoot: join(workspace.root, '.staging', `cache-rebuild-${randomUUID()}`),
            sourcePath: original,
            audioSourceId: source.id,
            sourceSha256: source.fingerprint.sha256,
            metadata: source.metadata,
            processingSampleRate: 48_000,
          },
          new AbortController().signal,
        )
      }
      result.push(store.descriptor(manifest))
    }
    return result
  }
}

async function resolveOriginal(
  workspace: ProjectWorkspace,
  source: ProjectFile['audioSources'][number],
): Promise<string> {
  const path =
    source.location.mode === 'reference'
      ? source.location.path
      : await new ProjectPathResolver(workspace.root).resolve(source.location.path)
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('not a file')
    return path
  } catch (error) {
    throw new Error(`Original audio is unavailable for ${source.displayName}`, { cause: error })
  }
}

async function verifyFingerprint(
  path: string,
  expected: ProjectFile['audioSources'][number]['fingerprint'],
): Promise<void> {
  const info = await stat(path)
  if (info.size !== expected.byteLength) throw new Error('Original audio changed since import')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  if (hash.digest('hex') !== expected.sha256) throw new Error('Original audio changed since import')
}
