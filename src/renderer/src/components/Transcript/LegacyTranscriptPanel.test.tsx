// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/project.types'
import { TranscriptPanel } from './TranscriptPanel'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { togglePlayback } from '../../actions/playbackActions'
vi.mock('../../actions/playbackActions', () => ({ togglePlayback: vi.fn(async () => {}) }))
const track: Track = {
  id: 'track',
  name: 'Voice',
  volume: 1,
  muted: false,
  solo: false,
  color: '#cf7ba6',
  effects: [],
  clips: [
    {
      id: 'clip',
      trackId: 'track',
      audioSourceId: 'source' as never,
      sourceStart: 0,
      sourceEnd: 2,
      outputStart: 0,
      muted: true,
      gain: 1,
      effects: [],
    },
  ],
}
beforeEach(() => {
  useTimelineStore.getState().reset()
  useTranscriptStore.getState().reset()
  usePlaybackStore.getState().reset()
  useTimelineStore.setState({ tracks: [track] })
  useTranscriptStore.setState({
    words: [{ id: 'word', text: 'Hello', start: 0, end: 1, muted: false, trackId: 'track' }],
    visibleTrackIds: ['track'],
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
it('strikes clip redactions even at the playhead, but never treats ordinary track mute as redaction', () => {
  render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus="" />)
  expect(screen.getByText('Hello').style.textDecoration).toBe('line-through')
  act(() =>
    useTimelineStore.setState({
      tracks: [
        { ...track, muted: true, clips: track.clips.map((clip) => ({ ...clip, muted: false })) },
      ],
    }),
  )
  expect(screen.getByText('Hello').style.textDecoration).not.toBe('line-through')
})
it('uses shared redaction-aware playback for Space on legacy text', () => {
  render(<TranscriptPanel onGenerate={vi.fn()} isGenerating={false} generatingStatus="" />)
  fireEvent.keyDown(screen.getByRole('region', { name: 'Transcript' }), { key: ' ', code: 'Space' })
  expect(togglePlayback).toHaveBeenCalledOnce()
})
