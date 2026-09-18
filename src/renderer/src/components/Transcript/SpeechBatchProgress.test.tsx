// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SpeechBatchProgress } from './SpeechBatchProgress'
import { useSpeechBatchStore } from '../../stores/speechBatch.store'
import { useLocaleStore } from '../../stores/locale.store'
beforeEach(() => {
  useSpeechBatchStore.getState().reset()
  useLocaleStore.setState({ resolvedLocale: 'en' })
})
afterEach(cleanup)
it('shows source and phase with actual stage progress and cancellation', () => {
  useSpeechBatchStore.getState().begin()
  useSpeechBatchStore.getState().update(
    { stage: 'aligning', percent: 35 },
    {
      phase: 'text',
      sourceIndex: 2,
      sourceCount: 3,
      audioSourceId: 'source' as never,
      displayName: 'Voice.wav',
    },
  )
  const cancel = vi.fn()
  render(
    <SpeechBatchProgress
      isGenerating
      status={{ stage: 'aligning', percent: 35 }}
      onCancel={cancel}
    />,
  )
  expect(screen.getByText('Transcript and alignment · 2 of 3')).toBeTruthy()
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.queryByText('Generating transcript…')).toBeNull()
  const details = screen.getByRole('button', { name: 'Details' })
  expect(details.getAttribute('aria-expanded')).toBe('false')
  expect(document.getElementById(details.getAttribute('aria-controls')!)?.hidden).toBe(true)
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('35')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
})
it('localizes retained cancellation and per-source failures', () => {
  useSpeechBatchStore.getState().finish({
    sourceCount: 2,
    completedCount: 1,
    reusedCount: 0,
    cancelled: true,
    failures: [
      {
        audioSourceId: 'source' as never,
        displayName: 'Voice.wav',
        phase: 'speakers',
        error: { reason: 'operation-failed' },
      },
    ],
  })
  render(<SpeechBatchProgress isGenerating={false} status={null} />)
  expect(screen.getByText('Analysis cancelled. Published text is retained.')).toBeTruthy()
  expect(screen.getByText(/Voice.wav: The operation could not be completed/)).toBeTruthy()
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByText('分析已取消，已生成的文本会保留。')).toBeTruthy()
})

it('keeps a compact dismissible success with counts in collapsed details', () => {
  useSpeechBatchStore
    .getState()
    .finish({ sourceCount: 2, completedCount: 1, reusedCount: 1, cancelled: false, failures: [] })
  render(<SpeechBatchProgress isGenerating={false} status={null} />)
  expect(screen.getByText('Analysis complete')).toBeTruthy()
  const details = screen.getByRole('button', { name: 'Details' })
  expect(details.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(details)
  expect(document.getElementById(details.getAttribute('aria-controls')!)?.hidden).toBe(false)
  expect(screen.getByText(/1 completed, 1 reused/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss analysis status' }))
  expect(screen.queryByRole('status')).toBeNull()
})
