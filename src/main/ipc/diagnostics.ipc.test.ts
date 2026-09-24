import { beforeEach, expect, it, vi } from 'vitest'
import type { DiagnosticReport } from '../diagnostics/DiagnosticReport'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showSaveDialog: vi.fn(),
  showItemInFolder: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
  dialog: { showSaveDialog: mocks.showSaveDialog },
  shell: { showItemInFolder: mocks.showItemInFolder },
}))
import { registerDiagnosticsIpc } from './diagnostics.ipc'

beforeEach(() => {
  mocks.handlers.clear()
  mocks.showSaveDialog.mockReset()
  mocks.showItemInFolder.mockReset()
})

it('keeps cancel quiet and saves only a main-owned snapshot', async () => {
  const reports = {
    saveReport: vi.fn(),
    suggestedFilename: vi.fn(() => 'redencut-diagnostics-550e8400.json'),
    savedPath: vi.fn(() => '/private/report.json'),
    recentFailure: vi.fn(),
    previewReport: vi.fn(),
  }
  registerDiagnosticsIpc(reports as unknown as DiagnosticReport)
  mocks.showSaveDialog
    .mockResolvedValueOnce({ canceled: true })
    .mockResolvedValueOnce({ canceled: false, filePath: '/private/report.json' })
  expect(await mocks.handlers.get('diagnostics:save')!(null, 'preview-id')).toEqual({
    ok: true,
    value: { status: 'cancelled' },
  })
  expect(reports.saveReport).not.toHaveBeenCalled()
  expect(await mocks.handlers.get('diagnostics:save')!(null, 'preview-id')).toEqual({
    ok: true,
    value: { status: 'saved' },
  })
  expect(reports.saveReport).toHaveBeenCalledWith('preview-id', '/private/report.json')
  await mocks.handlers.get('diagnostics:show-saved')!(null, 'preview-id')
  expect(mocks.showItemInFolder).toHaveBeenCalledWith('/private/report.json')
})

it('maps a denied save to fixed public text', async () => {
  const reports = {
    saveReport: vi.fn().mockRejectedValue(new Error('/private/token=secret')),
    suggestedFilename: vi.fn(() => 'redencut-diagnostics-550e8400.json'),
    savedPath: vi.fn(),
    recentFailure: vi.fn(),
    previewReport: vi.fn(),
  }
  registerDiagnosticsIpc(reports as unknown as DiagnosticReport)
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/private/report.json' })
  const result = await mocks.handlers.get('diagnostics:save')!(null, 'preview-id')
  expect(result).toMatchObject({ ok: false, error: { reason: 'report-save-failed' } })
  expect(JSON.stringify(result)).not.toContain('/private/')
})
