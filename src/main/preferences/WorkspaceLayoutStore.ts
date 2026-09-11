import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  DEFAULT_WORKSPACE_LAYOUT,
  WorkspaceLayoutSchema,
  decodeStoredWorkspaceLayout,
  type WorkspaceLayout,
  type WorkspaceLayoutReadResult,
} from '../../shared/workspaceLayout.types'

export class WorkspaceLayoutStore {
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async read(): Promise<WorkspaceLayoutReadResult> {
    // A read observes every write admitted before it, including failed writes.
    await this.writes
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { layout: WorkspaceLayoutSchema.parse(DEFAULT_WORKSPACE_LAYOUT), warning: null }
      throw error
    }
    let input: unknown
    try {
      input = JSON.parse(raw)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      return {
        layout: WorkspaceLayoutSchema.parse(DEFAULT_WORKSPACE_LAYOUT),
        warning: 'Workspace preferences could not be read. Default layout is in use.',
      }
    }
    return decodeStoredWorkspaceLayout(input)
  }

  write(input: WorkspaceLayout): Promise<WorkspaceLayout> {
    const parsed = WorkspaceLayoutSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(parsed.error)
    // Zod snapshots the caller's object before it enters the write queue.
    const layout = parsed.data
    const operation = this.writes.then(async () => {
      await this.persist(layout)
      return layout
    })
    this.writes = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async persist(layout: WorkspaceLayout): Promise<void> {
    const directory = dirname(this.filePath)
    await fs.mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${basename(this.filePath)}.${randomUUID()}.tmp`)
    // Only clean up a temporary file after this operation owns its creation.
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      try {
        await handle.writeFile(JSON.stringify(layout, null, 2) + '\n')
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, this.filePath)
    } catch (error) {
      try {
        await fs.rm(temporary, { force: true })
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Workspace preferences could not be saved or cleaned up.',
          { cause: cleanupError },
        )
      }
      throw error
    }
  }
}
