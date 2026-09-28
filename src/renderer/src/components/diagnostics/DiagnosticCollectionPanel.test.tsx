// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../settings/SettingsDialog'
import { useLocaleStore } from '../../stores/locale.store'
import type { DiagnosticReportPreview } from '@shared/DiagnosticBundleTypes'
const preview: DiagnosticReportPreview = {
  previewId: 'preview',
  totalBytes: 1234,
  manifest: {
    bundleVersion: 1,
    generatedAt: '2026-09-28T00:00:00.000Z',
    environment: {
      appVersion: 'test',
      platform: 'darwin',
      osVersion: 'test',
      architecture: 'arm64',
    },
    diagnosticIds: [],
    files: [{ path: 'runtime/runtime.jsonl', kind: 'runtime', bytes: 1000 }],
    coverage: { scope: 'retained-history' },
    losses: {
      droppedRecords: { info: 0, warn: 0, error: 0 },
      truncatedRecords: 0,
      writeFailures: 0,
      countersComplete: true,
    },
    warnings: [],
  },
}
const api = {
  previewReport: vi.fn(async () => preview),
  saveReport: vi.fn(async () => ({ status: 'cancelled' as 'saved' | 'cancelled' })),
  showSavedReport: vi.fn(async () => {}),
  inspectReport: vi.fn(async () => {}),
  releaseReport: vi.fn(async () => {}),
}
beforeEach(() => {
  useLocaleStore.setState({ resolvedLocale: 'en' })
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { diagnostics: api } })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('collects without a failure, shows files and treats save cancellation quietly', async () => {
  render(
    <SettingsDialog
      initialTab="diagnostics"
      autoCollect
      diagnosticsRequest={{ kind: 'recent' }}
      onClose={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  expect(screen.getByText(/Review the files before attaching/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save bundle…' }))
  await waitFor(() => expect(api.saveReport).toHaveBeenCalledWith('preview'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull()
})
it('offers retry after save failure and lets users inspect the exact files', async () => {
  api.saveReport.mockRejectedValueOnce({ reason: 'report-save-failed' })
  render(
    <SettingsDialog
      initialTab="diagnostics"
      autoCollect
      diagnosticsRequest={{ kind: 'recent' }}
      onClose={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Review files' }))
  await waitFor(() => expect(api.inspectReport).toHaveBeenCalledWith('preview'))
  fireEvent.click(screen.getByRole('button', { name: 'Save bundle…' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be saved'))
  expect(screen.getByRole('button', { name: 'Choose another location…' })).toBeTruthy()
})
it('retranslates the summary without recollection and releases its snapshot on close', async () => {
  const { unmount } = render(
    <SettingsDialog
      initialTab="diagnostics"
      autoCollect
      diagnosticsRequest={{ kind: 'recent' }}
      onClose={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  useLocaleStore.setState({ resolvedLocale: 'zh-CN' })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存诊断包…' })).toBeTruthy())
  expect(api.previewReport).toHaveBeenCalledOnce()
  unmount()
  expect(api.releaseReport).toHaveBeenCalledWith('preview')
})

it('releases a preview that finishes after its dialog closes', async () => {
  let resolve!: (value: DiagnosticReportPreview) => void
  api.previewReport.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const { unmount } = render(
    <SettingsDialog
      initialTab="diagnostics"
      autoCollect
      diagnosticsRequest={{ kind: 'recent' }}
      onClose={vi.fn()}
    />,
  )
  unmount()
  resolve(preview)
  await waitFor(() => expect(api.releaseReport).toHaveBeenCalledWith('preview'))
})

it('retries a failed collection and reveals only a successful save', async () => {
  api.previewReport.mockRejectedValueOnce({ reason: 'operation-failed' })
  render(
    <SettingsDialog
      initialTab="diagnostics"
      autoCollect
      diagnosticsRequest={{ kind: 'recent' }}
      onClose={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Collect again' }))
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  api.saveReport.mockResolvedValueOnce({ status: 'saved' })
  fireEvent.click(screen.getByRole('button', { name: 'Save bundle…' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
  await waitFor(() => expect(api.showSavedReport).toHaveBeenCalledWith('preview'))
})

it('introduces diagnostics before collecting and keeps file review independent of disclosure', async () => {
  render(<SettingsDialog initialTab="diagnostics" onClose={vi.fn()} />)
  expect(screen.getByText("What's included")).toBeTruthy()
  expect(
    screen.getByText('No audio, transcripts or project files. Nothing is uploaded.'),
  ).toBeTruthy()
  expect(api.previewReport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Collect diagnostics' }))
  await screen.findByText('Ready to save')
  const files = screen.getByText('Included files').closest('details')!
  expect(files.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Review files' }))
  await waitFor(() => expect(api.inspectReport).toHaveBeenCalledWith('preview'))
  expect(files.open).toBe(false)
  expect(screen.getByRole('button', { name: 'Save bundle…' })).toBeTruthy()
})

it('navigates an already open Settings window to Diagnostics without auto collecting', async () => {
  const { rerender } = render(<SettingsDialog initialTab="theme" onClose={vi.fn()} />)
  rerender(<SettingsDialog initialTab="diagnostics" onClose={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeTruthy()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(api.previewReport).not.toHaveBeenCalled()
})

it('clears the released failure snapshot when returning to manual recent collection', async () => {
  const { rerender } = render(
    <SettingsDialog
      initialTab="diagnostics"
      autoCollect
      diagnosticsRequest={{ kind: 'failure', diagnosticIds: ['failure-id'] }}
      onClose={vi.fn()}
    />,
  )
  await screen.findByText('Ready to save')
  rerender(
    <SettingsDialog
      initialTab="diagnostics"
      diagnosticsRequest={{ kind: 'recent' }}
      onClose={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.queryByText('Ready to save')).toBeNull())
  expect(screen.getByRole('button', { name: 'Collect diagnostics' })).toBeTruthy()
  expect(api.releaseReport).toHaveBeenCalledWith('preview')
})

it('returns to Diagnostics when the same entry is invoked again after switching tabs', async () => {
  const { rerender } = render(
    <SettingsDialog initialTab="diagnostics" navigationId={1} onClose={vi.fn()} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Theme' }))
  expect(screen.getByRole('heading', { name: 'Theme' })).toBeTruthy()
  rerender(<SettingsDialog initialTab="diagnostics" navigationId={2} onClose={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeTruthy()
})
