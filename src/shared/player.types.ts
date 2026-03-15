// ─────────────────────────────────────────────────────────────────────────────
// IAudioPlayer — the single abstraction between the UI and the playback engine
//
// All components that need to control or observe audio (TransportBar,
// WaveformView, useKeyboardShortcuts) talk exclusively to this interface.
// The concrete implementation behind it can be swapped without touching any UI:
//
//   SimpleAudioPlayer  — Phase 1: <audio> + GainNode, works immediately
//   WebCodecsPlayer    — Phase 2: frame-accurate skip, multi-track mixing
//
// Lifecycle:
//   1. Create: new ConcretePlayer()
//   2. Load:   await player.loadSourceFile(id, filePath)
//   3. Edit:   player.setTracks(tracks)   — call whenever clip model changes
//   4. Play:   player.play() / pause() / seekTo()
//   5. Destroy: player.destroy()          — called when file is closed
// ─────────────────────────────────────────────────────────────────────────────

import type { Track } from './project.types'

export interface IAudioPlayer {
  // ── Playback control ───────────────────────────────────────────────────────

  play(): Promise<void>
  pause(): void

  /** Convenience: toggle between play and pause. */
  playPause(): Promise<void>

  /**
   * Seek to a position in the OUTPUT timeline (seconds).
   * In the single-file case, output time === source time.
   * When clips are moved, output time maps into the rearranged sequence.
   */
  seekTo(outputTime: number): void

  // ── State queries ──────────────────────────────────────────────────────────

  /** Current position in the output timeline (seconds). */
  getCurrentTime(): number

  /** Total duration of the output timeline (seconds). */
  getDuration(): number

  isPlaying(): boolean

  // ── Edit model ─────────────────────────────────────────────────────────────

  /**
   * Register a source file with the player.
   * Must be called before any clip referencing this sourceFileId can play.
   * Resolves once the player has enough metadata (duration) to seek.
   */
  loadSourceFile(id: string, filePath: string): Promise<void>

  /**
   * Push the current track/clip state to the player.
   * Call this whenever the timeline store changes (after mute, split, move…).
   * The player updates its internal gain graph / decode schedule accordingly.
   */
  setTracks(tracks: Track[]): void

  // ── Event subscriptions ────────────────────────────────────────────────────
  // All subscriptions return an unsubscribe function — use in useEffect cleanup.

  /** Fires on every animation frame while playing; also fires on manual seeks. */
  onTimeUpdate(callback: (time: number) => void): () => void

  /** Fires when isPlaying changes. */
  onPlayStateChange(callback: (playing: boolean) => void): () => void

  /** Fires once when the duration is first known (after loadSourceFile resolves). */
  onDurationChange(callback: (duration: number) => void): () => void

  /** Fires when playback reaches the end of the output timeline. */
  onEnded(callback: () => void): () => void

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Release all resources. Call when closing a file. */
  destroy(): void
}

// ── Module-level singleton handle ─────────────────────────────────────────────
// Provides imperative access to the current player from anywhere (keyboard
// shortcuts, waveform interactions) without prop drilling or React context.
// Only one player is active at a time.

let _playerInstance: IAudioPlayer | null = null

export function getAudioPlayerInstance(): IAudioPlayer | null {
  return _playerInstance
}

export function setAudioPlayerInstance(player: IAudioPlayer | null): void {
  _playerInstance = player
}
