import { useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import type { Track, TrackContent } from '@shared/ProjectTypes'
import { useTimelineStore } from '../stores/TimelineStore'

/** Volume stays in the source store for playback and saving, outside content subscriptions. */
export function useTrackContent(): TrackContent[] {
  const select = useMemo(() => {
    let previous: TrackContent[] = []
    let input: Track[] | undefined
    return (state: { tracks: Track[] }) => {
      if (input === state.tracks) return previous
      input = state.tracks
      const next = state.tracks.map(({ id, name, clips, muted, solo, color, effects }) => ({
        id,
        name,
        clips,
        muted,
        solo,
        color,
        effects,
      }))
      if (
        previous.length !== next.length ||
        next.some((track, index) => !shallow(track, previous[index]))
      )
        previous = next
      return previous
    }
  }, [])
  return useTimelineStore(select)
}
