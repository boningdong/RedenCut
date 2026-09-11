// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AudioSourceId, Track } from '@shared/project.types'
import { TransportBar } from './TransportBar'
import { useTimelineStore } from '../../stores/timeline.store'

beforeEach(() => useTimelineStore.getState().reset())
afterEach(cleanup)

it('reflects actual edit history and restores timeline clips with undo and redo', () => {
  const track: Track = {
    id: 'track',
    name: 'Voice',
    color: '#a393ee',
    volume: 1,
    muted: false,
    solo: false,
    effects: [],
    clips: [
      {
        id: 'clip',
        trackId: 'track',
        audioSourceId: 'source' as AudioSourceId,
        sourceStart: 0,
        sourceEnd: 10,
        outputStart: 0,
        gain: 1,
        muted: false,
        effects: [],
      },
    ],
  }
  useTimelineStore.setState({ tracks: [track], selectedClipId: 'clip' })
  render(<TransportBar />)
  const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
  const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement
  expect(undo.disabled).toBe(true)
  expect(redo.disabled).toBe(true)
  act(() => useTimelineStore.getState().splitAt(5))
  expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
  expect(undo.disabled).toBe(false)
  fireEvent.click(undo)
  expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(1)
  expect(undo.disabled).toBe(true)
  expect(redo.disabled).toBe(false)
  fireEvent.click(redo)
  expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
  expect(redo.disabled).toBe(true)
})

it('disables playback when the timeline has no audio', () => {
  render(<TransportBar />)
  expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
})
