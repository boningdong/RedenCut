import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, expect, test, vi } from 'vitest'
const native = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
}))
vi.mock('electron', () => ({ dialog: native }))
import { createProjectDialogs } from './createProjectDialogs'

const roots: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})
const window = {} as BrowserWindow
test('production selection preserves native options, suffix normalization and cancellation', async () => {
  const dialogs = createProjectDialogs(false, {})
  native.showOpenDialog
    .mockResolvedValueOnce({ canceled: false, filePaths: ['/voice.wav'] })
    .mockResolvedValueOnce({ canceled: true, filePaths: [] })
  native.showSaveDialog
    .mockResolvedValueOnce({ canceled: false, filePath: '/episode' })
    .mockResolvedValueOnce({ canceled: true })
  expect(await dialogs.importAudio(window)).toBe('/voice.wav')
  expect(native.showOpenDialog).toHaveBeenCalledWith(
    window,
    expect.objectContaining({ title: 'Import Audio', properties: ['openFile'] }),
  )
  expect(await dialogs.openProject(window)).toBeNull()
  expect(native.showOpenDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ properties: ['openDirectory'] }),
  )
  expect(await dialogs.saveProject(window)).toBe('/episode.podcut')
  expect(await dialogs.saveProject(window)).toBeNull()
})
test('harness handles cancellation without native UI and logs unsupported dialogs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'podcut-main-dialog-'))
  roots.push(root)
  const directory = join(root, 'generation-1/dialogs')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'pending.json'),
    JSON.stringify({ purpose: 'import-audio', path: null }),
  )
  const dialogs = createProjectDialogs(true, {
    PODCUT_HARNESS_RUN_DIRECTORY: root,
    PODCUT_HARNESS_GENERATION: '1',
  })
  expect(await dialogs.importAudio(window)).toBeNull()
  await expect(dialogs.dirtyProject(window)).rejects.toThrow('DIALOG_NOT_PREPARED')
  await expect(dialogs.exportAudio(window, 'wav')).rejects.toThrow('DIALOG_NOT_PREPARED')
  expect(native.showOpenDialog).not.toHaveBeenCalled()
  expect(native.showSaveDialog).not.toHaveBeenCalled()
  const events = readFileSync(join(directory, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(events.map((event) => [event.state, event.purpose])).toEqual([
    ['consumed', 'import-audio'],
    ['rejected', 'dirty-project'],
    ['rejected', 'export-audio'],
  ])
})
test.each([undefined, '0', '../1', '1.2'])(
  'harness rejects invalid generation %s',
  (generation) => {
    expect(() => createProjectDialogs(true, { PODCUT_HARNESS_GENERATION: generation })).toThrow(
      'INVALID_HARNESS_GENERATION',
    )
  },
)
