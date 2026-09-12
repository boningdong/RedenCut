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
import { createTranslator } from '../../shared/i18n/createTranslator'

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
  expect(await dialogs.saveProject(window)).toBe('/episode.riffcut')
  expect(await dialogs.saveProject(window)).toBeNull()
})
test('harness handles cancellation without native UI and logs unsupported dialogs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'riffcut-main-dialog-'))
  roots.push(root)
  const directory = join(root, 'generation-1/dialogs')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'pending.json'),
    JSON.stringify({ purpose: 'import-audio', path: null }),
  )
  const dialogs = createProjectDialogs(true, {
    RIFFCUT_HARNESS_RUN_DIRECTORY: root,
    RIFFCUT_HARNESS_GENERATION: '1',
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
    expect(() => createProjectDialogs(true, { RIFFCUT_HARNESS_GENERATION: generation })).toThrow(
      'INVALID_HARNESS_GENERATION',
    )
  },
)

test('native dialogs resolve the committed language at invocation and retain response mapping', async () => {
  let translator = createTranslator('en').getFixedT('en')
  const dialogs = createProjectDialogs(false, {}, () => translator)
  native.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/voice.wav'] })
  native.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/episode' })
  native.showMessageBox.mockResolvedValue({ response: 0 })
  await dialogs.importAudio(window)
  expect(native.showOpenDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({
      title: 'Import Audio',
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'aac', 'm4a', 'ogg', 'aiff'] },
      ],
    }),
  )
  await dialogs.saveProject(window)
  expect(native.showSaveDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ title: 'Save RiffCut Project', defaultPath: 'Untitled.riffcut' }),
  )
  await dialogs.openProject(window)
  expect(native.showOpenDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ title: 'Open RiffCut Project' }),
  )
  await dialogs.exportAudio(window, 'wav')
  expect(native.showSaveDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({
      title: 'Export Audio',
      defaultPath: 'export.wav',
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    }),
  )
  expect(await dialogs.dirtyProject(window)).toBe('save')
  expect(native.showMessageBox).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({
      message: 'Save changes before opening another project?',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    }),
  )
  translator = createTranslator('zh-CN').getFixedT('zh-CN')
  await dialogs.importAudio(window)
  expect(native.showOpenDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({
      title: '导入音频',
      filters: [
        { name: '音频文件', extensions: ['wav', 'mp3', 'flac', 'aac', 'm4a', 'ogg', 'aiff'] },
      ],
    }),
  )
  expect(await dialogs.saveProject(window)).toBe('/episode.riffcut')
  expect(native.showSaveDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ title: '保存 RiffCut 项目', defaultPath: '未命名.riffcut' }),
  )
  await dialogs.openProject(window)
  expect(native.showOpenDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({ title: '打开 RiffCut 项目' }),
  )
  expect(await dialogs.exportAudio(window, 'flac')).toBe('/episode')
  expect(native.showSaveDialog).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({
      title: '导出音频',
      defaultPath: 'export.flac',
      filters: [{ name: 'FLAC', extensions: ['flac'] }],
    }),
  )
  expect(await dialogs.dirtyProject(window)).toBe('save')
  expect(native.showMessageBox).toHaveBeenLastCalledWith(
    window,
    expect.objectContaining({
      message: '打开其他项目前要保存更改吗？',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
    }),
  )
  native.showMessageBox
    .mockResolvedValueOnce({ response: 1 })
    .mockResolvedValueOnce({ response: 2 })
  expect(await dialogs.dirtyProject(window)).toBe('discard')
  expect(await dialogs.dirtyProject(window)).toBe('cancel')
})
