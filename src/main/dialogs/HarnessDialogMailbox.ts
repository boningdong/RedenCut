import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HarnessDialogReplySchema } from '../../shared/harnessDialog.types'

export class HarnessDialogMailbox {
  constructor(private readonly directory: string) {}

  consume(purpose: string, format?: string): string | null {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const claimed = join(this.directory, `${randomUUID()}.claimed`)
    try {
      try {
        renameSync(join(this.directory, 'pending.json'), claimed)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new Error('DIALOG_NOT_PREPARED', { cause: error })
        throw error
      }
      const reply = HarnessDialogReplySchema.parse(JSON.parse(readFileSync(claimed, 'utf8')))
      if (reply.purpose !== purpose) throw new Error('DIALOG_PURPOSE_MISMATCH')
      if (reply.path && purpose === 'export-audio' && reply.format !== format)
        throw new Error('DIALOG_FORMAT_MISMATCH')
      if (reply.path) {
        if (!reply.parent || realpathSync(dirname(reply.path)) !== reply.parent)
          throw new Error('DIALOG_PATH_CHANGED')
        if (purpose !== 'save-project' && purpose !== 'export-audio') {
          if (realpathSync(reply.path) !== reply.path) throw new Error('DIALOG_PATH_CHANGED')
          const stat = lstatSync(reply.path)
          if (purpose === 'import-audio' ? !stat.isFile() : !stat.isDirectory())
            throw new Error('DIALOG_PATH_TYPE_CHANGED')
        }
      }
      // Recheck destination existence at consumption, not only at preparation.
      if ((purpose === 'save-project' || purpose === 'export-audio') && reply.path) {
        try {
          lstatSync(reply.path)
          throw new Error(
            purpose === 'export-audio' ? 'EXPORT_ALREADY_EXISTS' : 'PROJECT_ALREADY_EXISTS',
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      this.record('consumed', purpose)
      return reply.path
    } catch (error) {
      this.record('rejected', purpose, String(error))
      throw error
    } finally {
      rmSync(claimed, { force: true })
    }
  }

  private record(state: string, purpose: string, error?: string): void {
    appendFileSync(
      join(this.directory, 'events.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), state, purpose, error }) + '\n',
      { mode: 0o600 },
    )
  }
}
