// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TranscriptPanel } from './TranscriptPanel'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useSpeechBatchStore } from '../../stores/speechBatch.store'
import { useLocaleStore } from '../../stores/locale.store'
afterEach(cleanup)
it('keeps first-generation progress after the empty body in the dedicated footer', () => {
  useTranscriptStore.getState().reset()
  useTimelineStore.getState().reset()
  useSpeechBatchStore.getState().reset()
  useLocaleStore.setState({ resolvedLocale: 'en' })
  const cancel = vi.fn()
  render(
    <TranscriptPanel
      onGenerate={vi.fn()}
      isGenerating
      generatingStatus={{ stage: 'transcribing', percent: 42 }}
      onCancel={cancel}
    />,
  )
  const footer = screen.getByRole('region', { name: 'Transcription status' })
  const progress = screen.getByRole('progressbar')
  expect(footer.contains(progress)).toBe(true)
  expect(
    screen.getByText('No transcript yet').compareDocumentPosition(footer) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(progress.getAttribute('aria-valuenow')).toBe('42')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
})
