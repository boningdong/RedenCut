// ─────────────────────────────────────────────────────────────────────────────
// Playback Store (Zustand)
//
// Owns the ephemeral playback state: is audio playing? what's the current time?
// This is SEPARATE from the project store (which owns the edits and file data).
//
// Why separate stores?
//   1. Playback state changes at 60fps (every animation frame) — re-rendering
//      the entire app on every tick would be catastrophically slow.
//   2. Playback is independent of the project: you can play/pause without
//      modifying the project. Separating them prevents unnecessary re-renders.
//   3. When we add multi-track later, each track gets its own playback slice.
//
// Zustand usage pattern:
//   const isPlaying = usePlaybackStore(s => s.isPlaying)   ← subscribe to a slice
//   const { play, pause } = usePlaybackStore()              ← get actions
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand'

interface PlaybackState {
  isPlaying: boolean
  currentTime: number // editing timeline seconds
  duration: number // editing timeline seconds
  outputCurrentTime: number
  outputDuration: number

  timelineRevealRequest: { time: number } | null
  revealTimelineTime: (time: number) => void

  // ── Actions ──────────────────────────────────────────────────────────────
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number, outputTime?: number) => void
  setDuration: (duration: number, outputDuration?: number) => void
  reset: () => void
}

const initialState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  outputCurrentTime: 0,
  outputDuration: 0,
  timelineRevealRequest: null,
}

export const usePlaybackStore = create<PlaybackState>()((set) => ({
  ...initialState,

  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time, outputTime = time) =>
    set({ currentTime: time, outputCurrentTime: outputTime }),
  setDuration: (duration, outputDuration = duration) => set({ duration, outputDuration }),

  // A fresh request also handles clicking the same word after manually scrolling away.
  revealTimelineTime: (time) => set({ timelineRevealRequest: { time } }),

  reset: () => set(initialState),
}))
