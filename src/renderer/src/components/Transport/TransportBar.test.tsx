// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import { TransportBar } from './TransportBar'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useEffect } from 'react'
import { usePlaybackStore } from '../../stores/PlaybackStore'
import { PlaybackTimelineAdapter } from '../../audio/PlaybackTimelineAdapter'
import { setAudioPlayerInstance, type RenderAudioPlayer } from '@shared/PlayerTypes'

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

it('refreshes edited output duration after a paused settings change at timeline zero', () => {
  const tracks: Track[] = [
    {
      id: 't',
      name: 'Voice',
      color: '#fff',
      volume: 1,
      muted: false,
      solo: false,
      effects: [],
      clips: [
        {
          id: 'c',
          trackId: 't',
          audioSourceId: 's' as AudioSourceId,
          gain: 1,
          muted: false,
          effects: [],
          sourceStart: 0,
          sourceEnd: 2,
          outputStart: 0,
          redactions: [
            {
              id: 'r',
              sourceStart: 0.8,
              sourceEnd: 1.04,
              crossfade: { enabled: true, durationMs: 30, curve: 'linear' },
            },
          ],
        },
      ],
    },
  ]
  const raw = {
    getCurrentTime: () => 0,
    setTracks: () => {},
    setPlaybackMode: () => {},
    seekTo: () => {},
  } as unknown as RenderAudioPlayer
  const player = new PlaybackTimelineAdapter(raw)
  useTimelineStore.setState({ tracks })
  player.setTracks(tracks)
  player.setPlaybackMode('edited')
  setAudioPlayerInstance(player)
  usePlaybackStore.getState().setDuration(2, player.getOutputDuration())
  const stop = player.onDurationChange((duration) =>
    usePlaybackStore.getState().setDuration(duration, player.getOutputDuration()),
  )
  // App deliberately publishes tracks after rendering; the transport must subscribe
  // to output-clock updates instead of sampling the previous plan during rendering.
  function AppLike() {
    const currentTracks = useTimelineStore((s) => s.tracks)
    useEffect(() => player.setTracks(currentTracks), [currentTracks])
    return <TransportBar />
  }
  const view = render(<AppLike />)
  try {
    expect(view.container.querySelector('.transport-time small')?.textContent).toBe('/ 00:01.73')
    act(() =>
      useTimelineStore.getState().updateRedactionCrossfade('c', 'r', {
        enabled: true,
        durationMs: 60,
        curve: 'linear',
      }),
    )
    expect(player.getOutputDuration()).toBe(1.7)
    expect(view.container.querySelector('.transport-time small')?.textContent).toBe('/ 00:01.70')
  } finally {
    stop()
    setAudioPlayerInstance(null)
  }
})
