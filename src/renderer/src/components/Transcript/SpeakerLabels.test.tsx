import { useLocaleStore } from '../../stores/locale.store'
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SpeakerLabels } from './SpeakerLabels'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useEditorStore } from '../../stores/editor.store'
import type { Track } from '@shared/ProjectTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'

const analysis = {
  diarizationStatus: 'completed',
  audioSourceId: 'source',
  analysisRevisionId: 'revision',
  speakers: [{ id: 'speaker', defaultDisplayName: 'Guest', diarizationLabel: 'SPEAKER_00' }],
  speakerLabelOverrides: [],
} as unknown as RendererSpeechAnalysis
beforeEach(() => {
  useLocaleStore.setState({ resolvedLocale: 'en' })
  useTranscriptStore.getState().reset()
  useTimelineStore.getState().reset()
  useTimelineStore.setState({
    tracks: [
      { id: 'track', name: 'Track', color: '#abcdef', clips: [{ audioSourceId: 'source' }] },
    ] as unknown as Track[],
  })
  useEditorStore.getState().reset()
  useTranscriptStore.getState().loadAnalyses([analysis])
})
afterEach(() => {
  cleanup()
  useLocaleStore.setState({ resolvedLocale: 'en' })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('toggles immediately and opens its dedicated editor without toggling visibility', () => {
  render(<SpeakerLabels analyses={[analysis]} isGenerating={false} />)
  const label = screen.getByRole('button', { name: 'Show Guest' })
  fireEvent.click(label)
  expect(label.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guest' }))
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
  expect(useTranscriptStore.getState().hiddenSpeakerKeys).toHaveLength(1)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('does not offer editable identities until diarization is complete', () => {
  render(<SpeakerLabels analyses={[{ ...analysis, diarizationStatus: 'pending' }]} isGenerating />)
  expect(screen.queryByRole('button', { name: 'Edit Guest' })).toBeNull()
})

it('keeps unassigned visibility source scoped across refreshed speaker results', () => {
  const other = { ...analysis, audioSourceId: 'other' as never }
  const { rerender } = render(
    <SpeakerLabels
      analyses={[analysis, other]}
      isGenerating
      unassignedSourceIds={['source', 'other']}
    />,
  )
  const toggles = screen.getAllByRole('button', { name: /^Show Unassigned/ })
  fireEvent.click(toggles[0])
  expect(toggles[0].getAttribute('aria-pressed')).toBe('false')
  expect(toggles[1].getAttribute('aria-pressed')).toBe('true')
  rerender(
    <SpeakerLabels
      analyses={[{ ...analysis, analysisRevisionId: 'new' as never }, other]}
      isGenerating={false}
      unassignedSourceIds={['source', 'other']}
    />,
  )
  expect(
    screen.getAllByRole('button', { name: /^Show Unassigned/ })[0].getAttribute('aria-pressed'),
  ).toBe('false')
  expect(useTranscriptStore.getState().hiddenSpeakerKeys).toEqual(['source:unassigned'])
})
