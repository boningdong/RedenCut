// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DiagnosticReportDialog } from './DiagnosticReportDialog'
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
  render(<DiagnosticReportDialog request={{ kind: 'recent' }} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  expect(screen.getByText(/Review the collected files/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle…' }))
  await waitFor(() => expect(api.saveReport).toHaveBeenCalledWith('preview'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull()
})
it('offers retry after save failure and lets users inspect the exact files', async () => {
  api.saveReport.mockRejectedValueOnce({ reason: 'report-save-failed' })
  render(<DiagnosticReportDialog request={{ kind: 'recent' }} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Inspect collected files' }))
  await waitFor(() => expect(api.inspectReport).toHaveBeenCalledWith('preview'))
  fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle…' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be saved'))
  expect(screen.getByRole('button', { name: 'Choose another location…' })).toBeTruthy()
})
it('retranslates the summary without recollection and releases its snapshot on close', async () => {
  const { unmount } = render(
    <DiagnosticReportDialog request={{ kind: 'recent' }} onClose={vi.fn()} />,
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
    <DiagnosticReportDialog request={{ kind: 'recent' }} onClose={vi.fn()} />,
  )
  unmount()
  resolve(preview)
  await waitFor(() => expect(api.releaseReport).toHaveBeenCalledWith('preview'))
})

it('retries a failed collection and reveals only a successful save', async () => {
  api.previewReport.mockRejectedValueOnce({ reason: 'operation-failed' })
  render(<DiagnosticReportDialog request={{ kind: 'recent' }} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Collect again' }))
  await waitFor(() => expect(screen.getByText('runtime/runtime.jsonl')).toBeTruthy())
  api.saveReport.mockResolvedValueOnce({ status: 'saved' })
  fireEvent.click(screen.getByRole('button', { name: 'Save diagnostic bundle…' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }))
  await waitFor(() => expect(api.showSavedReport).toHaveBeenCalledWith('preview'))
})
