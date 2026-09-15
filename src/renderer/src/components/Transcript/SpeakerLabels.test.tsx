import { useLocaleStore } from '../../stores/locale.store'
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
  useLocaleStore.setState({ resolvedLocale: 'en' })
  useTranscriptStore.getState().reset()
  useTimelineStore.getState().reset()
  useEditorStore.getState().reset()
  useTranscriptStore.getState().loadAnalyses([analysis])
})
afterEach(() => {
  cleanup()
  useLocaleStore.setState({ resolvedLocale: 'en' })
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

it('keeps a color-only edit independent of the display locale and preserves an open name draft', async () => {
  const generated = {
    ...analysis,
    speakers: [{ ...analysis.speakers[0], defaultDisplayName: 'Speaker 1' }],
  }
  useEditorStore.setState({ session: { workspaceToken: 'test', revision: 1 } as never })
  const rename = vi.fn(async (_request: unknown) => {
    throw new Error('private diagnostic')
  })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { speakerLabel: { rename } },
  })
  render(<SpeakerLabels analyses={[generated]} isGenerating={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Change color for Speaker 1' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), {
    target: { value: '#abcdef' },
  })
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '应用颜色' }))
  })
  expect(rename.mock.calls[0][0]).toMatchObject({ displayName: 'Speaker 1', color: '#abcdef' })
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  fireEvent.doubleClick(screen.getByRole('button', { name: '显示 说话人 1' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My custom guest' } })
  act(() => useLocaleStore.setState({ resolvedLocale: 'en' }))
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('My custom guest')
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
  const toggles = screen.getAllByRole('button', { name: 'Show Unassigned speaker' })
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
    screen
      .getAllByRole('button', { name: 'Show Unassigned speaker' })[0]
      .getAttribute('aria-pressed'),
  ).toBe('false')
  expect(useTranscriptStore.getState().hiddenSpeakerKeys).toEqual(['source:unassigned'])
})
