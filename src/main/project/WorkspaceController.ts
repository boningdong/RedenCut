import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import type { AudioSourceCacheDescriptor } from '../../shared/import.types'
import { ProjectFileSchema, type AudioSourceId, type ProjectFile } from '../../shared/project.types'
import type {
  ProjectDraft,
  ProjectMutationRequest,
  RendererSession,
  SessionPrecondition,
  WorkspaceToken,
} from '../../shared/session.types'
import { AudioSourceCacheStore } from '../audio/cache/AudioSourceCacheStore'
import { FfmpegAudioSourceCacheBuilder } from '../audio/import/FfmpegAudioSourceCacheBuilder'
import { AsyncMutex } from './AsyncMutex'
import { ProjectPathResolver } from './ProjectPathResolver'
import { ProjectWorkspace } from './ProjectWorkspace'
import { mergeProjectDraft, toRendererSession } from './sessionProjection'

export interface PreparedWorkspace {
  readonly workspace: ProjectWorkspace
  readonly descriptors: AudioSourceCacheDescriptor[]
}

export interface WorkspaceTransaction {
  readonly precondition: SessionPrecondition
  describe(): Promise<RendererSession>
  save(draft: ProjectDraft): Promise<RendererSession>
  saveAs(destination: string, draft: ProjectDraft): Promise<RendererSession>
  prepareOpen(root: string): Promise<PreparedWorkspace>
  commitPreparedOpen(candidate: PreparedWorkspace): Promise<RendererSession>
  commitImport(authoritativeProject: ProjectFile): Promise<RendererSession>
}

interface TransactionState {
  workspace: ProjectWorkspace
  workspaceToken: WorkspaceToken
  revision: number
}

export class WorkspaceController {
  private readonly mutex = new AsyncMutex()
  private current: ProjectWorkspace | null = null
  private workspaceToken: WorkspaceToken | null = null
  private revision = 0

  constructor(private readonly cacheBuilder = new FfmpegAudioSourceCacheBuilder()) {}

  async initialize(temporaryParent: string): Promise<RendererSession> {
    return this.mutex.runExclusive(async () => {
      if (!this.current) {
        const candidate = await ProjectWorkspace.initialize(temporaryParent)
        const descriptors = await this.descriptors(candidate)
        this.current = candidate
        this.workspaceToken = randomUUID() as WorkspaceToken
        this.revision = 1
        return toRendererSession(candidate, this.workspaceToken, this.revision, descriptors)
      }
      return this.describeState(this.captureState())
    })
  }

  get workspace(): ProjectWorkspace {
    if (!this.current) throw new Error('Project workspace has not been initialized')
    return this.current
  }

  async describe(): Promise<RendererSession> {
    return this.mutex.runExclusive(() => this.describeState(this.captureState()))
  }

  async save(request: ProjectMutationRequest): Promise<RendererSession> {
    return this.runTransition(request, (transaction) => transaction.save(request.draft))
  }

  async saveAs(destination: string, request: ProjectMutationRequest): Promise<RendererSession> {
    return this.runTransition(request, (transaction) =>
      transaction.saveAs(destination, request.draft),
    )
  }

  async prepareOpen(root: string): Promise<PreparedWorkspace> {
    const workspace = await ProjectWorkspace.open(root)
    const descriptors = await this.descriptors(workspace)
    return { workspace, descriptors }
  }

  async commitPreparedOpen(
    candidate: PreparedWorkspace,
    expected: SessionPrecondition,
  ): Promise<RendererSession> {
    return this.runTransition(expected, (transaction) => transaction.commitPreparedOpen(candidate))
  }

  async open(root: string): Promise<RendererSession> {
    const expected = await this.describe()
    const candidate = await this.prepareOpen(root)
    return this.commitPreparedOpen(candidate, expected)
  }

  assertCurrent(expected: SessionPrecondition): void {
    if (!this.current || !this.workspaceToken)
      throw new Error('Project workspace has not been initialized')
    if (expected.workspaceToken !== this.workspaceToken) throw new Error('Stale workspace token')
    if (expected.revision !== this.revision) throw new Error('Stale workspace revision')
  }

  async runTransition<T>(
    expected: SessionPrecondition,
    operation: (transaction: WorkspaceTransaction) => Promise<T>,
  ): Promise<T> {
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(expected)
      const state = this.captureState()
      const transaction: WorkspaceTransaction = {
        get precondition() {
          return {
            workspaceToken: state.workspaceToken,
            revision: state.revision,
          }
        },
        describe: () => this.describeState(state),
        save: (draft) => this.saveState(state, draft),
        saveAs: (destination, draft) => this.saveAsState(state, destination, draft),
        prepareOpen: (root) => this.prepareOpen(root),
        commitPreparedOpen: (candidate) => this.commitPreparedOpenState(state, candidate),
        commitImport: (authoritativeProject) => this.commitImportState(state, authoritativeProject),
      }
      return operation(transaction)
    })
  }

  async resolveOriginal(audioSourceId: AudioSourceId): Promise<string> {
    const workspace = this.workspace
    const source = workspace.project.audioSources.find(
      (candidate) => candidate.id === audioSourceId,
    )
    if (!source) throw new Error(`Unknown audio source: ${audioSourceId}`)
    const path = await resolveOriginal(workspace, source)
    await verifyFingerprint(path, source.fingerprint)
    return path
  }

  private captureState(): TransactionState {
    if (!this.current || !this.workspaceToken)
      throw new Error('Project workspace has not been initialized')
    return {
      workspace: this.current,
      workspaceToken: this.workspaceToken,
      revision: this.revision,
    }
  }

  private async describeState(state: TransactionState): Promise<RendererSession> {
    const workspace = state.workspace
    const descriptors = await this.descriptors(workspace)
    return toRendererSession(workspace, state.workspaceToken, state.revision, descriptors)
  }

  private async saveState(state: TransactionState, draft: ProjectDraft): Promise<RendererSession> {
    const workspace = state.workspace
    const project = mergeProjectDraft(workspace.project, draft)
    const descriptors = await this.descriptors(workspace, project, 'quick')
    await workspace.save(project)
    this.advanceRetainingWorkspace(state, workspace)
    return toRendererSession(workspace, state.workspaceToken, state.revision, descriptors)
  }

  private async saveAsState(
    state: TransactionState,
    destination: string,
    draft: ProjectDraft,
  ): Promise<RendererSession> {
    const workspace = state.workspace
    const project = mergeProjectDraft(workspace.project, draft)
    let descriptors: AudioSourceCacheDescriptor[] | null = null
    const candidate = await workspace.saveAs(destination, project, async (prepared) => {
      descriptors = await this.descriptors(prepared)
    })
    if (!descriptors) throw new Error('Save As candidate was not validated')
    this.installWorkspace(state, candidate)
    await workspace.close().catch(() => {})
    return toRendererSession(candidate, state.workspaceToken, state.revision, descriptors)
  }

  private async commitPreparedOpenState(
    state: TransactionState,
    candidate: PreparedWorkspace,
  ): Promise<RendererSession> {
    const oldWorkspace = state.workspace
    this.installWorkspace(state, candidate.workspace)
    await oldWorkspace.close().catch(() => {})
    return toRendererSession(
      candidate.workspace,
      state.workspaceToken,
      state.revision,
      candidate.descriptors,
    )
  }

  private async commitImportState(
    state: TransactionState,
    authoritativeProject: ProjectFile,
  ): Promise<RendererSession> {
    const workspace = state.workspace
    const project = ProjectFileSchema.parse(authoritativeProject)
    const descriptors = await this.descriptors(workspace, project, 'quick')
    await workspace.save(project)
    this.advanceRetainingWorkspace(state, workspace)
    return toRendererSession(workspace, state.workspaceToken, state.revision, descriptors)
  }

  private advanceRetainingWorkspace(state: TransactionState, workspace: ProjectWorkspace): void {
    state.workspace = workspace
    state.revision += 1
    this.current = workspace
    this.workspaceToken = state.workspaceToken
    this.revision = state.revision
  }

  private installWorkspace(state: TransactionState, workspace: ProjectWorkspace): void {
    state.workspace = workspace
    state.workspaceToken = randomUUID() as WorkspaceToken
    state.revision += 1
    this.current = workspace
    this.workspaceToken = state.workspaceToken
    this.revision = state.revision
  }

  private async descriptors(
    workspace: ProjectWorkspace,
    project: ProjectFile = workspace.project,
    originalValidation: 'full' | 'quick' = 'full',
  ): Promise<AudioSourceCacheDescriptor[]> {
    const store = new AudioSourceCacheStore(workspace.root)
    const result: AudioSourceCacheDescriptor[] = []
    for (const source of project.audioSources) {
      const original = await resolveOriginal(workspace, source)
      await verifyFingerprint(original, source.fingerprint, originalValidation === 'full')
      let manifest = await store.validate(source)
      if (!manifest) {
        if (originalValidation === 'quick')
          await verifyFingerprint(original, source.fingerprint, true)
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
  includeHash = true,
): Promise<void> {
  const info = await stat(path)
  if (info.size !== expected.byteLength) throw new Error('Original audio changed since import')
  if (!includeHash) return
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  if (hash.digest('hex') !== expected.sha256) throw new Error('Original audio changed since import')
}
