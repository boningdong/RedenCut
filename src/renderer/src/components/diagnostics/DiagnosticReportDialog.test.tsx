// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DiagnosticReportDialog } from './DiagnosticReportDialog'
import { useLocaleStore } from '../../stores/locale.store'

const id = '550e8400-e29b-41d4-a716-446655440001'
const preview = {
  previewId: 'preview',
  content: '{"reportVersion":1,"events":[]}',
  eventCount: 0,
  partial: true,
  diagnosticIds: [id],
}
const api = {
  previewReport: vi.fn(async () => preview),
  saveReport: vi.fn(async () => ({ status: 'cancelled' as const })),
  showSavedReport: vi.fn(),
  recentFailure: vi.fn(),
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

it('previews exact JSON, explains exclusions and handles save cancel quietly', async () => {
  render(<DiagnosticReportDialog diagnosticIds={[id]} onClose={vi.fn()} />)
  await waitFor(() =>
    expect(screen.getByLabelText('Report preview').textContent).toBe(preview.content),
  )
  expect(
    screen.getByText(/Audio, transcript text, project files and tokens are excluded/),
  ).toBeTruthy()
  expect(screen.getByRole('note').textContent).toContain('partial')
  fireEvent.click(screen.getByRole('button', { name: 'Save report…' }))
  await waitFor(() => expect(api.saveReport).toHaveBeenCalledWith('preview'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull()
})

it('offers another destination after a failed save', async () => {
  api.saveReport.mockRejectedValueOnce({ reason: 'report-save-failed' })
  render(<DiagnosticReportDialog diagnosticIds={[id]} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByLabelText('Report preview')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Save report…' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be saved'))
  expect(screen.getByRole('button', { name: 'Choose another location…' })).toBeTruthy()
})
