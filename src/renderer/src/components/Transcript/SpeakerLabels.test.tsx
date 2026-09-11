// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SpeakerLabels } from './SpeakerLabels'
import { useTranscriptStore } from '../../stores/transcript.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useEditorStore } from '../../stores/editor.store'
import type { RendererSpeechAnalysis } from '@shared/speech.types'

const analysis = {
  audioSourceId: 'source',
  analysisRevisionId: 'revision',
  speakers: [{ id: 'speaker', defaultDisplayName: 'Guest', diarizationLabel: 'SPEAKER_00' }],
  speakerLabelOverrides: [],
} as unknown as RendererSpeechAnalysis
beforeEach(() => {
  useTranscriptStore.getState().reset()
  useTimelineStore.getState().reset()
  useEditorStore.getState().reset()
  useTranscriptStore.getState().loadAnalyses([analysis])
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('single click toggles transcript visibility, while double click opens rename without toggling', () => {
  vi.useFakeTimers()
  render(<SpeakerLabels analyses={[analysis]} isGenerating={false} />)
  const label = screen.getByRole('button', { name: 'Show Guest' })
  fireEvent.click(label, { detail: 1 })
  act(() => {
    vi.advanceTimersByTime(400)
  })
  expect(label.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(label, { detail: 1 })
  fireEvent.click(label, { detail: 2 })
  fireEvent.doubleClick(label)
  act(() => {
    vi.advanceTimersByTime(400)
  })
  expect(screen.getByRole('textbox', { name: 'Rename Guest' })).toBeTruthy()
  expect(useTranscriptStore.getState().hiddenSpeakerKeys).toHaveLength(1)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(screen.getByRole('button', { name: 'Show Guest' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
})
it('color control is independent of visibility and reports invalid hex without sending a mutation', () => {
  useEditorStore.setState({ session: { workspaceToken: 'test', revision: 1 } as never })
  render(<SpeakerLabels analyses={[analysis]} isGenerating={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Change color for Guest' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), { target: { value: 'red' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply color' }))
  expect(screen.getByRole('alert').textContent).toContain('six-digit hex')
  expect(useTranscriptStore.getState().hiddenSpeakerKeys).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Hex color' })).toBeNull()
})

it('reserves future track colors and keeps the error reachable outside a clipped panel', () => {
  useEditorStore.setState({ session: { workspaceToken: 'test', revision: 1 } as never })
  const { container } = render(
    <div style={{ height: 120, overflow: 'hidden' }}>
      <SpeakerLabels analyses={[analysis]} isGenerating={false} />
    </div>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Change color for Guest' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), {
    target: { value: '#70b7b1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Apply color' }))
  expect(screen.getByRole('alert').textContent).toContain('reserved')
  expect(container.contains(screen.getByRole('button', { name: 'Apply color' }))).toBe(false)
})

it('a slower native double click restores visibility before opening rename', () => {
  vi.useFakeTimers()
  render(<SpeakerLabels analyses={[analysis]} isGenerating={false} />)
  const label = screen.getByRole('button', { name: 'Show Guest' })
  fireEvent.click(label, { detail: 1 })
  act(() => {
    vi.advanceTimersByTime(400)
  })
  fireEvent.click(label, { detail: 2 })
  fireEvent.doubleClick(label)
  expect(useTranscriptStore.getState().hiddenSpeakerKeys).toHaveLength(0)
  expect(screen.getByRole('textbox', { name: 'Rename Guest' })).toBeTruthy()
})
