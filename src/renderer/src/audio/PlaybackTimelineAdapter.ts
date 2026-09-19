import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import type {
  AudioSampleProvider,
  IAudioPlayer,
  PlaybackDiagnostics,
  PlaybackMode,
  RenderAudioPlayer,
} from '@shared/PlayerTypes'
import { buildAudioRenderPlan } from '@shared/audio/AudioRenderPlanBuilder'
import { timelineToOutputFrame, outputToTimelineFrame } from '@shared/audio/TimelineTimeMap'

/** Keeps editing surfaces in timeline coordinates while the engine runs a contracted output clock. */
export class PlaybackTimelineAdapter implements IAudioPlayer {
  private tracks: Track[] = []
  private mode: PlaybackMode = 'timeline'
  private plan = buildAudioRenderPlan([], 'timeline')
  private durationListeners = new Set<(duration: number) => void>()
  constructor(private readonly raw: RenderAudioPlayer) {}

  private timelineTime(output: number): number {
    return outputToTimelineFrame(this.plan.timeMap, Math.round(output * 48000)) / 48000
  }
  private outputTime(timeline: number): number {
    return timelineToOutputFrame(this.plan.timeMap, Math.round(timeline * 48000)) / 48000
  }
  setPlaybackMode(mode: PlaybackMode): void {
    if (mode === this.mode) return
    const position = this.getCurrentTime()
    this.mode = mode
    this.plan = buildAudioRenderPlan(this.tracks, mode)
    this.raw.setPlaybackMode(mode)
    if (Math.abs(this.raw.getCurrentTime() - this.outputTime(position)) > 0.5 / 48000)
      this.seekTo(position)
    this.durationListeners.forEach((listener) => listener(this.getDuration()))
  }
  setTracks(tracks: Track[]): void {
    const previous = this.plan
    const position = this.getCurrentTime()
    this.tracks = tracks
    this.plan = buildAudioRenderPlan(tracks, this.mode)
    this.raw.setTracks(tracks)
    if (
      JSON.stringify(previous.timeMap) !== JSON.stringify(this.plan.timeMap) &&
      Math.abs(this.raw.getCurrentTime() - this.outputTime(position)) > 0.5 / 48000
    )
      this.seekTo(position)
    this.durationListeners.forEach((listener) => listener(this.getDuration()))
  }
  seekTo(timelineTime: number): void {
    this.raw.seekTo(this.outputTime(timelineTime))
  }
  getCurrentTime(): number {
    return this.timelineTime(this.raw.getCurrentTime())
  }
  getDuration(): number {
    return this.plan.timeMap.timelineDurationFrames / 48000
  }
  getOutputCurrentTime(): number {
    return this.raw.getCurrentTime()
  }
  getOutputDuration(): number {
    return this.plan.durationFrames / 48000
  }
  play(): Promise<void> {
    return this.raw.play()
  }
  pause(): void {
    this.raw.pause()
  }
  playPause(): Promise<void> {
    return this.raw.playPause()
  }
  isPlaying(): boolean {
    return this.raw.isPlaying()
  }
  registerAudioSource(id: AudioSourceId, samples: AudioSampleProvider): Promise<void> {
    return this.raw.registerAudioSource(id, samples)
  }
  removeAudioSource(id: AudioSourceId): void {
    this.raw.removeAudioSource(id)
  }
  getDiagnostics(): PlaybackDiagnostics {
    return this.raw.getDiagnostics()
  }
  onTimeUpdate(callback: (time: number) => void): () => void {
    return this.raw.onTimeUpdate((time) => callback(this.timelineTime(time)))
  }
  onDurationChange(callback: (duration: number) => void): () => void {
    this.durationListeners.add(callback)
    return () => this.durationListeners.delete(callback)
  }
  onPlayStateChange(callback: (playing: boolean) => void): () => void {
    return this.raw.onPlayStateChange(callback)
  }
  onEnded(callback: () => void): () => void {
    return this.raw.onEnded(callback)
  }
  onError(callback: (error: Error) => void): () => void {
    return this.raw.onError(callback)
  }
  destroy(): Promise<void> {
    this.durationListeners.clear()
    return this.raw.destroy()
  }
}
