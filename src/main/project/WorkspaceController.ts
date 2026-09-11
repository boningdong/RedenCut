import { randomUUID } from 'crypto'
import { realpath, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
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
import { verifyAudioFingerprint } from '../audio/import/audioFingerprint'
import type { SpeechArtifact } from '../../shared/speechArtifact.schema'
import { SpeechArtifactStore } from '../speech/SpeechArtifactStore'
import type { RenameSpeakerRequest } from '../../shared/speakerLabel.types'
import { AsyncMutex } from './AsyncMutex'
import { discardCleanupWarnings, type CleanupWarningSink } from './CleanupWarningSink'
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
  saveAsForOpen(destination: string, draft: ProjectDraft): Promise<RendererSession>
  releaseRetiredWorkspaces(): Promise<void>
  prepareOpen(root: string): Promise<PreparedWorkspace>
  commitPreparedOpen(candidate: PreparedWorkspace): Promise<RendererSession>
  commitImport(authoritativeProject: ProjectFile): Promise<RendererSession>
  commitSpeechAnalysis(artifact: SpeechArtifact, draft: ProjectDraft): Promise<RendererSession>
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
  private readonly retainedRetiredWorkspaces = new Set<ProjectWorkspace>()
  private readonly preparedAgainstWorkspace = new WeakMap<PreparedWorkspace, ProjectWorkspace>()

  constructor(
    private readonly cacheBuilder = new FfmpegAudioSourceCacheBuilder(),
    private readonly cleanupWarningSink: CleanupWarningSink = discardCleanupWarnings,
    private readonly saveAsPolicy: 'replace' | 'create' = 'replace',
  ) {}

  async initialize(temporaryParent: string): Promise<RendererSession> {
    return this.mutex.runExclusive(async () => {
      if (!this.current) {
        const candidate = await ProjectWorkspace.initialize(temporaryParent, {
          saveAsPolicy: this.saveAsPolicy,
          cleanupWarningSink: this.cleanupWarningSink,
        })
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
    const workspace = await ProjectWorkspace.open(root, {
      saveAsPolicy: this.saveAsPolicy,
      cleanupWarningSink: this.cleanupWarningSink,
    })
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

  async commitSpeechAnalysis(
    expected: SessionPrecondition,
    artifact: SpeechArtifact,
    draft: ProjectDraft,
  ): Promise<RendererSession> {
    return this.runTransition(expected, (transaction) =>
      transaction.commitSpeechAnalysis(artifact, draft),
    )
  }

  async renameSpeaker(request: RenameSpeakerRequest): Promise<RendererSession> {
    return this.runTransition(
      { workspaceToken: request.workspaceToken as WorkspaceToken, revision: request.revision },
      async (transaction) => {
        const state = transaction.precondition
        const workspace = this.workspace
        const reference = workspace.project.speechArtifacts.find(
          (candidate) =>
            candidate.audioSourceId === request.audioSourceId &&
            candidate.analysisRevisionId === request.analysisRevisionId,
        )
        const artifact = workspace.speechArtifacts.find(
          (candidate) =>
            candidate.audioSourceId === request.audioSourceId &&
            candidate.analysisRevisionId === request.analysisRevisionId,
        )
        if (!reference || !artifact) throw new Error('Speaker label request is stale')
        if (!artifact.speakers.some((speaker) => speaker.id === request.speakerId))
          throw new Error('Speaker label references an unknown speaker')
        const project = ProjectFileSchema.parse({
          ...workspace.project,
          speakerLabelOverrides: [
            ...workspace.project.speakerLabelOverrides.filter(
              (override) =>
                override.audioSourceId !== request.audioSourceId ||
                override.analysisRevisionId !== request.analysisRevisionId ||
                override.speakerId !== request.speakerId,
            ),
            {
              audioSourceId: request.audioSourceId,
              analysisRevisionId: request.analysisRevisionId,
              speechArtifactSha256: reference.artifactSha256,
              speakerId: request.speakerId,
              displayName: request.displayName,
              color:
                request.color ??
                workspace.project.speakerLabelOverrides.find(
                  (override) =>
                    override.audioSourceId === request.audioSourceId &&
                    override.analysisRevisionId === request.analysisRevisionId &&
                    override.speakerId === request.speakerId,
                )?.color,
            },
          ],
        })
        await workspace.save(project)
        const captured = this.captureState()
        if (
          captured.workspaceToken !== state.workspaceToken ||
          captured.revision !== state.revision
        )
          throw new Error('Stale workspace revision')
        this.advanceRetainingWorkspace(captured, workspace)
        return this.describeState(captured)
      },
    )
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
    signal?: AbortSignal,
  ): Promise<T> {
    return this.mutex.runExclusive(async () => {
      this.assertCurrent(expected)
      const state = this.captureState()
      const transactionRetiredWorkspaces = new Set<ProjectWorkspace>()
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
        saveAsForOpen: (destination, draft) =>
          this.saveAsState(state, destination, draft, (retired) => {
            transactionRetiredWorkspaces.add(retired)
            this.retainedRetiredWorkspaces.add(retired)
          }),
        releaseRetiredWorkspaces: () => this.releaseRetiredWorkspaces(transactionRetiredWorkspaces),
        prepareOpen: (root) => this.prepareOpenState(state, root),
        commitPreparedOpen: (candidate) => this.commitPreparedOpenState(state, candidate),
        commitImport: (authoritativeProject) => this.commitImportState(state, authoritativeProject),
        commitSpeechAnalysis: (artifact, draft) =>
          this.commitSpeechAnalysisState(state, artifact, draft),
      }
      return operation(transaction)
    }, signal)
  }

  async resolveOriginal(audioSourceId: AudioSourceId): Promise<string> {
    const workspace = this.workspace
    const source = workspace.project.audioSources.find(
      (candidate) => candidate.id === audioSourceId,
    )
    if (!source) throw new Error(`Unknown audio source: ${audioSourceId}`)
    const path = await resolveOriginal(workspace, source)
    await verifyAudioFingerprint(path, source.fingerprint)
    return path
  }

  captureOriginalResolver(
    expected: SessionPrecondition,
  ): (audioSourceId: AudioSourceId) => Promise<string> {
    this.assertCurrent(expected)
    const workspace = this.workspace
    const sources = new Map(workspace.project.audioSources.map((source) => [source.id, source]))
    return async (audioSourceId) => {
      const source = sources.get(audioSourceId)
      if (!source) throw new Error(`Unknown audio source: ${audioSourceId}`)
      const path = await resolveOriginal(workspace, source)
      await verifyAudioFingerprint(path, source.fingerprint)
      return path
    }
  }

  captureSpeechPcmResolver(expected: SessionPrecondition) {
    this.assertCurrent(expected)
    const workspace = this.workspace
    const sources = new Map(workspace.project.audioSources.map((source) => [source.id, source]))
    return async (audioSourceId: AudioSourceId) => {
      const source = sources.get(audioSourceId)
      if (!source) throw new Error(`Unknown audio source: ${audioSourceId}`)
      const store = new AudioSourceCacheStore(workspace.root)
      const manifest = await store.validate(source)
      if (!manifest) throw new Error('Speech audio cache is invalid')
      return {
        path: await store.resolvePcm(source),
        sampleRate: manifest.pcm.sampleRate,
        channels: manifest.pcm.channels,
      }
    }
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
    retainPrevious?: (workspace: ProjectWorkspace) => void,
  ): Promise<RendererSession> {
    const workspace = state.workspace
    const project = mergeProjectDraft(workspace.project, draft)
    await assertSafeSwitchRoot(workspace, destination)
    let descriptors: AudioSourceCacheDescriptor[] | null = null
    const candidate = await workspace.saveAs(destination, project, async (prepared) => {
      descriptors = await this.descriptors(prepared)
    })
    if (!descriptors) throw new Error('Save As candidate was not validated')
    this.installWorkspace(state, candidate)
    if (retainPrevious) retainPrevious(workspace)
    else await workspace.close('save-as-publication')
    return toRendererSession(candidate, state.workspaceToken, state.revision, descriptors)
  }

  private async releaseRetiredWorkspaces(workspaces: Set<ProjectWorkspace>): Promise<void> {
    for (const workspace of [...workspaces]) {
      await workspace.close('workspace-switch')
      workspaces.delete(workspace)
      this.retainedRetiredWorkspaces.delete(workspace)
    }
  }

  private async commitPreparedOpenState(
    state: TransactionState,
    candidate: PreparedWorkspace,
  ): Promise<RendererSession> {
    const oldWorkspace = state.workspace
    if (this.preparedAgainstWorkspace.get(candidate) !== oldWorkspace)
      await assertSafeSwitchRoot(oldWorkspace, candidate.workspace.root)
    this.preparedAgainstWorkspace.delete(candidate)
    this.installWorkspace(state, candidate.workspace)
    await oldWorkspace.close('workspace-switch')
    return toRendererSession(
      candidate.workspace,
      state.workspaceToken,
      state.revision,
      candidate.descriptors,
    )
  }

  private async prepareOpenState(
    state: TransactionState,
    root: string,
  ): Promise<PreparedWorkspace> {
    const candidate = await this.prepareOpen(root)
    try {
      await assertSafeSwitchRoot(state.workspace, candidate.workspace.root)
      this.preparedAgainstWorkspace.set(candidate, state.workspace)
      return candidate
    } catch (error) {
      await candidate.workspace.close().catch(() => {})
      throw error
    }
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

  private async commitSpeechAnalysisState(
    state: TransactionState,
    artifact: SpeechArtifact,
    draft: ProjectDraft,
  ): Promise<RendererSession> {
    const workspace = state.workspace
    const source = workspace.project.audioSources.find(
      (candidate) => candidate.id === artifact.audioSourceId,
    )
    if (!source) throw new Error('Speech analysis references an unknown AudioSource')
    if (
      source.fingerprint.byteLength !== artifact.sourceFingerprint.byteLength ||
      source.fingerprint.modifiedTimeMs !== artifact.sourceFingerprint.modifiedTimeMs ||
      source.fingerprint.sha256 !== artifact.sourceFingerprint.sha256
    )
      throw new Error('Speech analysis source fingerprint is stale')
    const baseProject = mergeProjectDraft(workspace.project, draft)
    const descriptors = await this.descriptors(workspace, baseProject, 'full')
    const store = new SpeechArtifactStore(workspace.root)
    const staged = await store.stage(store.prepare(artifact))
    let published = false
    try {
      const reference = await store.publish(staged)
      published = true
      const project = ProjectFileSchema.parse({
        ...baseProject,
        speechArtifacts: [
          ...baseProject.speechArtifacts.filter(
            (candidate) => candidate.audioSourceId !== artifact.audioSourceId,
          ),
          reference,
        ],
        speakerLabelOverrides: baseProject.speakerLabelOverrides.filter(
          (override) => override.audioSourceId !== artifact.audioSourceId,
        ),
      })
      await workspace.save(project)
      this.advanceRetainingWorkspace(state, workspace)
      return toRendererSession(workspace, state.workspaceToken, state.revision, descriptors)
    } finally {
      if (!published) await store.discard(staged).catch(() => {})
    }
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
      await verifyAudioFingerprint(original, source.fingerprint, originalValidation)
      let manifest = await store.validate(source)
      if (!manifest) {
        if (originalValidation === 'quick')
          await verifyAudioFingerprint(original, source.fingerprint, 'full')
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
        await verifyAudioFingerprint(original, source.fingerprint, 'full')
      }
      result.push(store.descriptor(manifest))
    }
    return result
  }
}

async function assertSafeSwitchRoot(
  oldWorkspace: ProjectWorkspace,
  candidateRoot: string,
): Promise<void> {
  if (oldWorkspace.descriptor.kind !== 'temporary') return
  const oldLexicalRoot = resolve(oldWorkspace.root)
  const candidateLexicalRoot = resolve(candidateRoot)
  const [oldRoot, candidate] = await Promise.all([
    canonicalRoot(oldWorkspace.root),
    canonicalRoot(candidateRoot),
  ])
  if (containsRoot(oldLexicalRoot, candidateLexicalRoot) || containsRoot(oldRoot, candidate))
    throw new Error('Candidate root overlaps the temporary workspace')
}

function containsRoot(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
}

async function canonicalRoot(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return resolve(await realpath(dirname(path)), basename(path))
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
