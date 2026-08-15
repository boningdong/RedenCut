import { access, realpath } from 'fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'
import { ProjectRelativePathSchema, type ProjectRelativePath } from '../../shared/project.types'

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
}

async function nearestExistingPath(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      await access(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) throw new Error(`No existing ancestor for ${path}`)
      current = parent
    }
  }
}

export class ProjectPathResolver {
  constructor(private readonly root: string) {}

  async resolve(value: string): Promise<string> {
    if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
      throw new Error(`Invalid project-relative path: ${value}`)
    }

    const parsed = ProjectRelativePathSchema.safeParse(value)
    if (!parsed.success) throw new Error(`Invalid project-relative path: ${value}`)

    const rootRealPath = await realpath(this.root)
    const candidate = resolve(rootRealPath, value)
    if (!isContained(rootRealPath, candidate)) {
      throw new Error(`Project path escapes project bundle: ${value}`)
    }

    const existing = await nearestExistingPath(candidate)
    const existingRealPath = await realpath(existing)
    if (!isContained(rootRealPath, existingRealPath)) {
      throw new Error(`Project path escapes project bundle: ${value}`)
    }
    return candidate
  }

  async toRelative(absolutePath: string): Promise<ProjectRelativePath> {
    const rootRealPath = await realpath(this.root)
    const candidateRealPath = await realpath(absolutePath)
    if (!isContained(rootRealPath, candidateRealPath)) {
      throw new Error(`Path escapes project bundle: ${absolutePath}`)
    }
    const value = relative(rootRealPath, candidateRealPath).split(sep).join('/')
    return ProjectRelativePathSchema.parse(value)
  }
}
