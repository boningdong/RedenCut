// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ProjectTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
import { SpeechTaskPopover } from './SpeechTaskPopover'
import { useLocaleStore } from '../../stores/locale.store'
const tracks = ['A', 'B', 'C'].map((id, index) => ({
  id,
  name: `Track ${index + 1}`,
  clips: [{ audioSourceId: id }],
  color: '#cf7ba6',
})) as Track[]
const analyses = [
  { audioSourceId: 'B', diarizationStatus: 'pending' },
  { audioSourceId: 'C', diarizationStatus: 'completed', diarization: {} },
] as RendererSpeechAnalysis[]
afterEach(cleanup)
function setup() {
  useLocaleStore.setState({ resolvedLocale: 'en' })
  const onRun = vi.fn()
  render(
    <SpeechTaskPopover tracks={tracks} analyses={analyses} isGenerating={false} onRun={onRun} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  return onRun
}
it('submits two independent steps once and shows only their target tracks', () => {
  const onRun = setup()
  const text = screen.getByRole('group', { name: 'Generate text' })
  const speakers = screen.getByRole('group', { name: 'Identify speakers' })
  expect(within(text).getByText('T1')).toBeTruthy()
  expect(within(text).queryByText('T2')).toBeNull()
  expect(within(speakers).getByText('T2')).toBeTruthy()
  expect(within(speakers).queryByText('T3')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Start processing' }))
  expect(onRun).toHaveBeenCalledWith({ kind: 'all' }, { text: 'missing', speakers: 'missing' })
})
it('rearms completed tasks without starting or selecting them', () => {
  const onRun = setup()
  fireEvent.change(screen.getByLabelText('Tracks to process'), { target: { value: 'C' } })
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate text' }))
  const checkbox = screen.getByRole('checkbox', { name: 'Generate text' }) as HTMLInputElement
  expect(checkbox.checked).toBe(false)
  expect(onRun).not.toHaveBeenCalled()
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Identify speakers' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start processing' }))
  expect(onRun).toHaveBeenCalledWith(
    { kind: 'track', trackId: 'C' },
    { text: 'replace', speakers: 'missing' },
  )
})
it('requires text for unfinished sources but allows speaker-only processing for an aligned track', () => {
  const onRun = setup()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Generate text' }))
  expect(
    (screen.getByRole('button', { name: 'Start processing' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  fireEvent.change(screen.getByLabelText('Tracks to process'), { target: { value: 'B' } })
  expect(screen.queryByRole('checkbox', { name: 'Generate text' })).toBeNull()
  const speakers = screen.getByRole('group', { name: 'Identify speakers' })
  expect(within(speakers).getByText('T2')).toBeTruthy()
  expect(within(speakers).queryByText('T1')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Start processing' }))
  expect(onRun).toHaveBeenCalledWith(
    { kind: 'track', trackId: 'B' },
    { text: 'skip', speakers: 'missing' },
  )
})
it('can rearm only speaker recognition while keeping completed text', () => {
  const onRun = setup()
  fireEvent.change(screen.getByLabelText('Tracks to process'), { target: { value: 'C' } })
  fireEvent.click(screen.getByRole('button', { name: 'Identify speakers again' }))
  const checkbox = screen.getByRole('checkbox', { name: 'Identify speakers' }) as HTMLInputElement
  expect(checkbox.checked).toBe(false)
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: 'Start processing' }))
  expect(onRun).toHaveBeenCalledWith(
    { kind: 'track', trackId: 'C' },
    { text: 'skip', speakers: 'replace' },
  )
})
