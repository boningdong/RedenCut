import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
  linkSync,
  unlinkSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative, isAbsolute, dirname } from 'node:path'
import {
  HarnessDialogRequestSchema,
  type HarnessDialogRequest,
} from '../../src/shared/harnessDialog.types'

function filename(value: string): string {
  if (
    value === '.' ||
    value === '..' ||
    /[/\\:]/.test(value) ||
    value.includes('\0') ||
    value.trim() !== value
  )
    throw new Error('INVALID_SELECTION_NAME')
  return value
}
function contained(root: string, path: string): string {
  const canonical = realpathSync(path)
  const suffix = relative(realpathSync(root), canonical)
  if (suffix === '..' || suffix.startsWith('../') || isAbsolute(suffix))
    throw new Error('SELECTION_OUTSIDE_ROOT')
  return canonical
}

export function prepareDialog(
  repositoryRoot: string,
  runDirectory: string,
  generation: number,
  input: HarnessDialogRequest,
): void {
  const request = HarnessDialogRequestSchema.parse(input)
  const directory = join(runDirectory, `generation-${generation}`, 'dialogs')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const pending = join(directory, 'pending.json')
  if (existsSync(pending)) throw new Error('DIALOG_ALREADY_PREPARED')
  let path: string | null = null
  if (request.selection.type !== 'cancel') {
    if (request.selection.type === 'file') {
      const root = join(repositoryRoot, 'e2e/fixtures/audio')
      const selected = join(root, filename(request.selection.filename))
      path = contained(root, selected)
      if (!lstatSync(path).isFile()) throw new Error('AUDIO_NOT_REGULAR_FILE')
    } else if (request.selection.type === 'export') {
      const name = filename(request.selection.filename)
      if (!name.endsWith(`.${request.selection.format}`) || name === `.${request.selection.format}`)
        throw new Error('INVALID_EXPORT_NAME')
      const root = join(runDirectory, 'exports')
      mkdirSync(root, { recursive: true, mode: 0o700 })
      if (lstatSync(root).isSymbolicLink()) throw new Error('EXPORT_ROOT_SYMLINK')
      contained(runDirectory, root)
      path = join(realpathSync(root), name)
      try {
        lstatSync(path)
        throw new Error('EXPORT_ALREADY_EXISTS')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    } else {
      const name = filename(request.selection.name)
      if (!name.endsWith('.riffcut') || name === '.riffcut') throw new Error('INVALID_PROJECT_NAME')
      const root = join(runDirectory, 'projects')
      mkdirSync(root, { recursive: true, mode: 0o700 })
      if (lstatSync(root).isSymbolicLink()) throw new Error('PROJECT_ROOT_SYMLINK')
      contained(runDirectory, root)
      path = join(realpathSync(root), name)
      if (request.purpose === 'save-project') {
        try {
          lstatSync(path)
          throw new Error('PROJECT_ALREADY_EXISTS')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      } else {
        path = contained(root, path)
        if (!lstatSync(path).isDirectory()) throw new Error('PROJECT_NOT_DIRECTORY')
      }
    }
  }
  const temporary = join(directory, `${randomUUID()}.tmp`)
  writeFileSync(
    temporary,
    JSON.stringify({
      purpose: request.purpose,
      format: request.selection.type === 'export' ? request.selection.format : null,
      path,
      parent: path ? realpathSync(dirname(path)) : null,
    }),
    {
      mode: 0o600,
      flag: 'wx',
    },
  )
  try {
    // An atomic hard link publishes a complete reply without replacing another publisher.
    linkSync(temporary, pending)
  } finally {
    unlinkSync(temporary)
  }
}
