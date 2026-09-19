// ─────────────────────────────────────────────────────────────────────────────
// IAudioPlayer — the single abstraction between the UI and the playback engine
//
// All components that need to control or observe audio (TransportBar,
// WaveformView, useKeyboardShortcuts) talk exclusively to this interface.
// The concrete implementation reads only validated managed PCM caches.
//
// Lifecycle:
//   1. Create: new ConcretePlayer()
//   2. Register managed PCM providers by AudioSourceId
//   3. Edit:   player.setTracks(tracks)   — call whenever clip model changes
//   4. Play:   player.play() / pause() / seekTo()
//   5. Destroy: player.destroy()          — called when file is closed
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioSourceId, Track } from './ProjectTypes'

type AudioSampleFormat = 'f32-planar'

export interface AudioSampleChunk {
  startFrame: number
  frameCount: number
  channels: Float32Array[]
}

export interface AudioSampleProvider {
  readonly audioSourceId: AudioSourceId
  readonly format: AudioSampleFormat
  readonly sampleRate: number
  readonly channels: number
  readonly frameCount: number

  readFrames(startFrame: number, frameCount: number, signal: AbortSignal): Promise<AudioSampleChunk>
}

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
   * Must be called before any clip referencing this AudioSourceId can play.
   * Resolves once the player has enough metadata (duration) to seek.
   */
  registerAudioSource(id: AudioSourceId, samples: AudioSampleProvider): Promise<void>

  /**
   * Push the current track/clip state to the player.
   * Call this whenever the timeline store changes (after mute, split, move…).
   * The player updates its internal gain graph / decode schedule accordingly.
   */
  setTracks(tracks: Track[]): void

  /**
   * Unregister a source file. Stops any in-flight decode, disconnects audio
   * nodes, and frees resources. Safe to call even if id is unknown.
   */
  removeAudioSource(id: AudioSourceId): void

  // ── Event subscriptions ────────────────────────────────────────────────────
  // All subscriptions return an unsubscribe function — use in useEffect cleanup.

  /** Fires on every animation frame while playing; also fires on manual seeks. */
  onTimeUpdate(callback: (time: number) => void): () => void

  /** Fires when isPlaying changes. */
  onPlayStateChange(callback: (playing: boolean) => void): () => void

  /** Fires whenever the output timeline duration changes. */
  onDurationChange(callback: (duration: number) => void): () => void

  /** Fires when playback reaches the end of the output timeline. */
  onEnded(callback: () => void): () => void

  onError(callback: (error: Error) => void): () => void

  getDiagnostics(): PlaybackDiagnostics

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Release all resources. Settles after asynchronous audio teardown completes. */
  destroy(): Promise<void>
}

export interface PlaybackDiagnostics {
  underruns: number
  maximumQueuedFrames: number
  maximumReadFrames: number
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
