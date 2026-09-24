import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { prepareDialog } from '../dialogs/prepareDialog'
import { HarnessDialogMailbox } from '../../src/main/dialogs/HarnessDialogMailbox'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'redencut-dialog-')))
  roots.push(root)
  const fixtures = join(root, 'e2e/fixtures/audio')
  mkdirSync(fixtures, { recursive: true })
  writeFileSync(join(fixtures, 'voice.wav'), 'audio')
  const run = join(root, 'run')
  mkdirSync(run)
  return {
    root,
    fixtures,
    run,
    mailbox: new HarnessDialogMailbox(join(run, 'generation-1/dialogs')),
  }
}
test('selects a fixture by filename and consumes its reply exactly once', () => {
  const { root, run, fixtures, mailbox } = setup()
  prepareDialog(root, run, 1, {
    purpose: 'import-audio',
    selection: { type: 'file', filename: 'voice.wav' },
  })
  expect(mailbox.consume('import-audio')).toBe(join(fixtures, 'voice.wav'))
  expect(() => mailbox.consume('import-audio')).toThrow('DIALOG_NOT_PREPARED')
})
test('refuses to replace a pending reply and invalidates a mismatched reply', () => {
  const { root, run, mailbox } = setup()
  const request = {
    purpose: 'save-project',
    selection: { type: 'project', name: 'episode.redencut' },
  } as const
  prepareDialog(root, run, 1, request)
  expect(() => prepareDialog(root, run, 1, request)).toThrow('DIALOG_ALREADY_PREPARED')
  expect(() => mailbox.consume('open-project')).toThrow('DIALOG_PURPOSE_MISMATCH')
  expect(() => mailbox.consume('save-project')).toThrow('DIALOG_NOT_PREPARED')
})
test('cancellation is explicit and does not leak across generations', () => {
  const { root, run, mailbox } = setup()
  prepareDialog(root, run, 1, { purpose: 'import-audio', selection: { type: 'cancel' } })
  const next = new HarnessDialogMailbox(join(run, 'generation-2/dialogs'))
  expect(() => next.consume('import-audio')).toThrow('DIALOG_NOT_PREPARED')
  expect(mailbox.consume('import-audio')).toBeNull()
})
test.each([
  '../voice.wav',
  '/tmp/voice.wav',
  'sub/voice.wav',
  'sub\\voice.wav',
  '..',
  'missing.wav',
])('rejects unsafe or missing audio filename %s', (filename) => {
  const { root, run } = setup()
  expect(() =>
    prepareDialog(root, run, 1, { purpose: 'import-audio', selection: { type: 'file', filename } }),
  ).toThrow()
  expect(existsSync(join(run, 'generation-1/dialogs/pending.json'))).toBe(false)
})
test('rejects fixture symlink escapes and non-files', () => {
  const { root, run, fixtures } = setup()
  writeFileSync(join(root, 'outside.wav'), 'outside')
  symlinkSync(join(root, 'outside.wav'), join(fixtures, 'escape.wav'))
  mkdirSync(join(fixtures, 'directory.wav'))
  for (const filename of ['escape.wav', 'directory.wav'])
    expect(() =>
      prepareDialog(root, run, 1, {
        purpose: 'import-audio',
        selection: { type: 'file', filename },
      }),
    ).toThrow()
})
test('save cannot overwrite and open requires an existing project directory within the run', () => {
  const { root, run, mailbox } = setup()
  const selection = { type: 'project', name: 'episode.redencut' } as const
  expect(() => prepareDialog(root, run, 1, { purpose: 'open-project', selection })).toThrow()
  prepareDialog(root, run, 1, { purpose: 'save-project', selection })
  const destination = mailbox.consume('save-project')!
  expect(destination).toBe(join(run, 'projects/episode.redencut'))
  mkdirSync(destination)
  expect(() => prepareDialog(root, run, 1, { purpose: 'save-project', selection })).toThrow(
    'PROJECT_ALREADY_EXISTS',
  )
  prepareDialog(root, run, 1, { purpose: 'open-project', selection })
  expect(mailbox.consume('open-project')).toBe(destination)
})
test('project names and project-root symlinks cannot escape the run', () => {
  const { root, run } = setup()
  for (const name of ['../outside.redencut', '/tmp/out.redencut', 'bad\\out.redencut', 'bare'])
    expect(() =>
      prepareDialog(root, run, 1, {
        purpose: 'save-project',
        selection: { type: 'project', name },
      }),
    ).toThrow()
  symlinkSync(root, join(run, 'projects'))
  expect(() =>
    prepareDialog(root, run, 1, {
      purpose: 'save-project',
      selection: { type: 'project', name: 'out.redencut' },
    }),
  ).toThrow()
})

test('consumption rejects a project parent replaced by an outside symlink after preparation', () => {
  const { root, run, mailbox } = setup()
  prepareDialog(root, run, 1, {
    purpose: 'save-project',
    selection: { type: 'project', name: 'out.redencut' },
  })
  rmSync(join(run, 'projects'), { recursive: true })
  symlinkSync(root, join(run, 'projects'))
  expect(() => mailbox.consume('save-project')).toThrow('DIALOG_PATH_CHANGED')
})

test('export destinations are run-owned, format-bound, single-use and never overwrite', () => {
  const { root, run, mailbox } = setup()
  const request = {
    purpose: 'export-audio',
    selection: { type: 'export', filename: 'mix.wav', format: 'wav' },
  } as const
  prepareDialog(root, run, 1, request)
  expect(() => mailbox.consume('export-audio', 'mp3')).toThrow('DIALOG_FORMAT_MISMATCH')
  prepareDialog(root, run, 1, request)
  expect(mailbox.consume('export-audio', 'wav')).toBe(join(run, 'exports/mix.wav'))
  expect(() => mailbox.consume('export-audio', 'wav')).toThrow('DIALOG_NOT_PREPARED')
  prepareDialog(root, run, 1, request)
  writeFileSync(join(run, 'exports/mix.wav'), 'existing')
  expect(() => mailbox.consume('export-audio', 'wav')).toThrow('EXPORT_ALREADY_EXISTS')
  expect(() => prepareDialog(root, run, 1, request)).toThrow('EXPORT_ALREADY_EXISTS')
})
test('diagnostic reports use a run-owned JSON destination and allow quiet cancellation', () => {
  const { root, run, mailbox } = setup()
  prepareDialog(root, run, 1, { purpose: 'diagnostic-report', selection: { type: 'cancel' } })
  expect(mailbox.consume('diagnostic-report')).toBeNull()
  const request = {
    purpose: 'diagnostic-report',
    selection: { type: 'report', filename: 'diagnostic.json' },
  } as const
  prepareDialog(root, run, 1, request)
  expect(mailbox.consume('diagnostic-report')).toBe(join(run, 'reports/diagnostic.json'))
  writeFileSync(join(run, 'reports/diagnostic.json'), '{}')
  expect(() => prepareDialog(root, run, 1, request)).toThrow('REPORT_ALREADY_EXISTS')
  expect(() =>
    prepareDialog(root, run, 1, {
      purpose: 'diagnostic-report',
      selection: { type: 'report', filename: '../private.json' },
    }),
  ).toThrow()
})
test('export cancellation needs no format and unsafe destinations never publish', () => {
  const { root, run, mailbox } = setup()
  prepareDialog(root, run, 1, { purpose: 'export-audio', selection: { type: 'cancel' } })
  expect(mailbox.consume('export-audio', 'wav')).toBeNull()
  for (const filename of ['../mix.wav', '/tmp/mix.wav', 'mix.mp3', '.wav', 'nested/mix.wav']) {
    expect(() =>
      prepareDialog(root, run, 1, {
        purpose: 'export-audio',
        selection: { type: 'export', filename, format: 'wav' },
      }),
    ).toThrow()
    expect(existsSync(join(run, 'generation-1/dialogs/pending.json'))).toBe(false)
  }
})
test('export parent cannot be replaced by a symlink to another run', () => {
  const { root, run, mailbox } = setup()
  const request = {
    purpose: 'export-audio',
    selection: { type: 'export', filename: 'mix.wav', format: 'wav' },
  } as const
  prepareDialog(root, run, 1, request)
  rmSync(join(run, 'exports'), { recursive: true })
  symlinkSync(root, join(run, 'exports'))
  expect(() => mailbox.consume('export-audio', 'wav')).toThrow('DIALOG_PATH_CHANGED')
  expect(() => prepareDialog(root, run, 1, request)).toThrow('EXPORT_ROOT_SYMLINK')
})
