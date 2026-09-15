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
  expect(screen.getByText('Transcript and alignment · 2 of 3 · Voice.wav')).toBeTruthy()
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
  expect(screen.getByText(/Analysis cancelled/)).toBeTruthy()
  expect(screen.getByText(/Voice.wav: The operation could not be completed/)).toBeTruthy()
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByText(/分析已取消/)).toBeTruthy()
})
