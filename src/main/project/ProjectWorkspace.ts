import { randomUUID } from 'crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type { ProjectOpenResult, WorkspaceDescriptor } from '../../shared/import.types'
import { createEmptyProject, ProjectFileSchema, type ProjectFile } from '../../shared/project.types'

export class ProjectWorkspace {
  private constructor(
    public root: string,
    public project: ProjectFile,
    private temporary: boolean,
  ) {}

  static async initialize(temporaryParent: string): Promise<ProjectWorkspace> {
    await mkdir(temporaryParent, { recursive: true })
    const root = await mkdtemp(join(temporaryParent, 'podcut-'))
    const project = createEmptyProject()
    await writeFile(join(root, 'project.json'), JSON.stringify(project, null, 2))
    return new ProjectWorkspace(root, project, true)
  }

  static async open(root: string): Promise<ProjectWorkspace> {
    const project = ProjectFileSchema.parse(
      JSON.parse(await readFile(join(root, 'project.json'), 'utf8')),
    )
    return new ProjectWorkspace(root, project, false)
  }

  get descriptor(): WorkspaceDescriptor {
    return {
      kind: this.temporary ? 'temporary' : 'saved',
      displayName: this.temporary ? 'Untitled' : basename(this.root, '.podcut'),
      portable: this.project.audioSources.every((source) => source.location.mode === 'copy'),
    }
  }

  async save(project: ProjectFile): Promise<void> {
    const validated = ProjectFileSchema.parse(project)
    const temporaryFile = join(this.root, `.project-${randomUUID()}.json`)
    try {
      await writeFile(temporaryFile, JSON.stringify(validated, null, 2))
      await rename(temporaryFile, join(this.root, 'project.json'))
      this.project = validated
    } finally {
      await rm(temporaryFile, { force: true }).catch(() => {})
    }
  }

  async saveAs(
    destination: string,
    project: ProjectFile,
    prepare?: (candidate: ProjectWorkspace) => Promise<void>,
  ): Promise<void> {
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
      const candidate = await ProjectWorkspace.open(stage)
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
      const oldRoot = this.root
      const oldWasTemporary = this.temporary
      this.root = destination
      this.project = validated
      this.temporary = false
      if (oldWasTemporary && oldRoot !== destination)
        await rm(oldRoot, { recursive: true, force: true }).catch(() => {})
      if (destinationBackedUp) await rm(backup, { recursive: true, force: true }).catch(() => {})
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  toOpenResult(sources: ProjectOpenResult['sources']): ProjectOpenResult {
    return { project: this.project, workspace: this.descriptor, sources }
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
