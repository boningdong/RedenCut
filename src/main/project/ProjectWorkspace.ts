import { reconcileSpeakerIdentities } from '../../shared/SpeakerIdentityReconciler'
import { toRendererSpeechAnalysis } from './sessionProjection'
import { randomUUID } from 'crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { WorkspaceDescriptor } from '../../shared/import.types'
import { createEmptyProject, ProjectFileSchema, type ProjectFile } from '../../shared/ProjectTypes'
import type { SpeechArtifact } from '../../shared/speechArtifact.schema'
import { SpeechArtifactStore } from '../speech/SpeechArtifactStore'
import {
  discardCleanupWarnings,
  recordCleanupWarning,
  type CleanupWarningOperation,
  type CleanupWarningSink,
} from './CleanupWarningSink'

interface ProjectWorkspaceOptions {
  saveAsPolicy?: 'replace' | 'create'
  cleanupWarningSink?: CleanupWarningSink
  remove?: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>
}

interface ProjectWorkspaceDependencies {
  saveAsPolicy: 'replace' | 'create'
  cleanupWarningSink: CleanupWarningSink
  remove: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>
}

export class ProjectWorkspace {
  private constructor(
    public root: string,
    public project: ProjectFile,
    public speechArtifacts: SpeechArtifact[],
    private temporary: boolean,
    private readonly dependencies: ProjectWorkspaceDependencies,
  ) {}

  static async initialize(
    temporaryParent: string,
    options: ProjectWorkspaceOptions = {},
  ): Promise<ProjectWorkspace> {
    await mkdir(temporaryParent, { recursive: true })
    const root = await mkdtemp(join(temporaryParent, 'redencut-'))
    const project = createEmptyProject()
    await writeFile(join(root, 'project.json'), JSON.stringify(project, null, 2))
    return new ProjectWorkspace(root, project, [], true, workspaceDependencies(options))
  }

  static async open(
    root: string,
    options: ProjectWorkspaceOptions = {},
  ): Promise<ProjectWorkspace> {
    const project = ProjectFileSchema.parse(
      JSON.parse(await readFile(join(root, 'project.json'), 'utf8')),
    )
    const artifactStore = new SpeechArtifactStore(root)
    const speechArtifacts = await Promise.all(
      project.speechArtifacts.map((reference) => artifactStore.load(reference)),
    )
    return new ProjectWorkspace(
      root,
      project,
      speechArtifacts,
      false,
      workspaceDependencies(options),
    )
  }

  get descriptor(): WorkspaceDescriptor {
    return {
      kind: this.temporary ? 'temporary' : 'saved',
      displayName: this.temporary ? 'Untitled' : basename(this.root, '.redencut'),
      portable: this.project.audioSources.every((source) => source.location.mode === 'copy'),
    }
  }

  async save(project: ProjectFile): Promise<void> {
    const validated = ProjectFileSchema.parse(project)
    const store = new SpeechArtifactStore(this.root)
    const speechArtifacts = await Promise.all(
      validated.speechArtifacts.map((reference) => store.load(reference)),
    )
    validated.speakerIdentities = reconcileSpeakerIdentities(
      validated.speakerIdentities,
      speechArtifacts.map((artifact) => toRendererSpeechAnalysis(artifact, validated)),
      validated.tracks,
    )
    const temporaryFile = join(this.root, `.project-${randomUUID()}.json`)
    try {
      await writeFile(temporaryFile, JSON.stringify(validated, null, 2))
      await rename(temporaryFile, join(this.root, 'project.json'))
      this.project = validated
      this.speechArtifacts = speechArtifacts
    } finally {
      await rm(temporaryFile, { force: true }).catch(() => {})
    }
  }

  async saveAs(
    destination: string,
    project: ProjectFile,
    prepare?: (candidate: ProjectWorkspace) => Promise<void>,
  ): Promise<ProjectWorkspace> {
    const validated = ProjectFileSchema.parse(project)
    if (destination === this.root && this.temporary)
      throw new Error('Cannot publish over the temporary workspace')
    const stage = join(dirname(destination), `.${basename(destination)}-${randomUUID()}.staging`)
    const backup = join(dirname(destination), `.${basename(destination)}-${randomUUID()}.backup`)
    await rm(stage, { recursive: true, force: true })
    let destinationBackedUp = false
    try {
      await cp(this.root, stage, { recursive: true })
      await writeFile(join(stage, 'project.json'), JSON.stringify(validated, null, 2))
      const candidate = await ProjectWorkspace.open(stage, this.dependencies)
      await prepare?.(candidate)
      await rm(join(stage, '.staging'), { recursive: true, force: true })
      await pruneManagedDirectory(
        join(stage, 'cache'),
        new Set(validated.audioSources.map((source) => source.id)),
      )
      await pruneManagedDirectory(
        join(stage, 'media'),
        new Set(
          validated.audioSources
            .filter((source) => source.location.mode === 'copy')
            .map((source) => source.id),
        ),
      )
      if (this.dependencies.saveAsPolicy === 'create') {
        // Atomic reservation: never back up or replace a destination created by another actor.
        await mkdir(destination)
        try {
          await rename(stage, destination)
        } catch (error) {
          // Only remove our empty reservation; preserve any concurrently added contents.
          await rmdir(destination).catch(() => {})
          throw error
        }
        candidate.root = destination
        return candidate
      }
      if (await exists(destination)) {
        await rename(destination, backup)
        destinationBackedUp = true
      }
      try {
        await rename(stage, destination)
      } catch (error) {
        if (destinationBackedUp) await rename(backup, destination)
        throw error
      }
      candidate.root = destination
      if (destinationBackedUp) {
        try {
          await this.dependencies.remove(backup, { recursive: true, force: true })
        } catch (cause) {
          await recordCleanupWarning(this.dependencies.cleanupWarningSink, {
            path: backup,
            operation: 'save-as-publication',
            kind: 'destination-backup',
            cause,
          })
        }
      }
      return candidate
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async close(operation: CleanupWarningOperation = 'workspace-switch'): Promise<void> {
    if (!this.temporary) return
    try {
      await this.dependencies.remove(this.root, { recursive: true, force: true })
    } catch (cause) {
      await recordCleanupWarning(this.dependencies.cleanupWarningSink, {
        path: this.root,
        operation,
        kind: 'temporary-workspace',
        cause,
      })
    }
  }
}

function workspaceDependencies(options: ProjectWorkspaceOptions): ProjectWorkspaceDependencies {
  return {
    saveAsPolicy: options.saveAsPolicy ?? 'replace',
    cleanupWarningSink: options.cleanupWarningSink ?? discardCleanupWarnings,
    remove: options.remove ?? rm,
  }
}

async function pruneManagedDirectory(
  root: string,
  retainedNames: ReadonlySet<string>,
): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await Promise.all(
    entries
      .filter((entry) => !entry.isDirectory() || !retainedNames.has(entry.name))
      .map((entry) => rm(join(root, entry.name), { recursive: true, force: true })),
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
