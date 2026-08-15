import type { AudioSourceId, Track } from '@shared/project.types'
import type { AudioSampleProvider, IAudioPlayer, PlaybackDiagnostics } from '@shared/player.types'
import { WORKLET_CODE, sendPcmChunk } from './AudioPlayerWorklet'
import { buildTrackPlaybackPlan, type PlaybackSegment } from './playbackPlan'

const SAMPLE_RATE = 48_000
const TARGET_FRAMES = SAMPLE_RATE * 2
const REFILL_FRAMES = SAMPLE_RATE * 1.5
const MAX_FRAMES = SAMPLE_RATE * 3
const READ_FRAMES = 4096

interface TrackQueue {
  node: AudioWorkletNode
  gain: GainNode
  generation: number
  queuedFrames: number
  plan: PlaybackSegment[]
  segmentIndex: number
  segmentOffset: number
  controller: AbortController
  filling: boolean
}

export class WorkletAudioPlayer implements IAudioPlayer {
  private context: AudioContext | null = null
  private providers = new Map<AudioSourceId, AudioSampleProvider>()
  private tracks: Track[] = []
  private queues = new Map<string, TrackQueue>()
  private playing = false
  private currentTime = 0
  private duration = 0
  private startedAt: number | null = null
  private positionAtStart = 0
  private animationFrame: number | null = null
  private rebuildToken = 0
  private queueGeneration = 0
  private diagnostics: PlaybackDiagnostics = {
    underruns: 0,
    maximumQueuedFrames: 0,
    maximumReadFrames: 0,
  }
  private timeCallbacks = new Set<(time: number) => void>()
  private stateCallbacks = new Set<(playing: boolean) => void>()
  private durationCallbacks = new Set<(duration: number) => void>()
  private endedCallbacks = new Set<() => void>()
  private errorCallbacks = new Set<(error: Error) => void>()

  async registerAudioSource(id: AudioSourceId, samples: AudioSampleProvider): Promise<void> {
    if (id !== samples.audioSourceId) throw new Error('Audio source provider identity mismatch')
    if (samples.sampleRate !== SAMPLE_RATE) throw new Error('Audio source cache must use 48000 Hz')
    this.providers.set(id, samples)
  }

  removeAudioSource(id: AudioSourceId): void {
    this.providers.delete(id)
  }

  setTracks(tracks: Track[]): void {
    const volumeOnlyChange = hasSamePlaybackStructure(this.tracks, tracks)
    this.tracks = tracks
    const nextDuration = tracks
      .flatMap((track) => track.clips)
      .reduce((max, clip) => Math.max(max, clip.outputStart + clip.sourceEnd - clip.sourceStart), 0)
    if (nextDuration !== this.duration) {
      this.duration = nextDuration
      this.durationCallbacks.forEach((callback) => callback(nextDuration))
    }
    if (this.context && volumeOnlyChange) {
      for (const track of tracks) {
        const queue = this.queues.get(track.id)
        if (queue) queue.gain.gain.value = track.volume
      }
    } else if (this.context) {
      this.suspendForRebuild()
      void this.rebuildQueues(this.currentTime).catch((error) => this.emitError(error))
    }
  }

  async play(): Promise<void> {
    if (this.playing) return
    this.playing = true
    this.stateCallbacks.forEach((callback) => callback(true))
    try {
      await this.ensureContext()
      if (this.queues.size === 0) {
        await this.rebuildQueues(this.currentTime)
        return
      }
      await Promise.all([...this.queues.values()].map((queue) => this.fill(queue)))
      if (!this.playing) return
      if (this.context!.state === 'suspended') await this.context!.resume()
      this.startedAt = null
      this.positionAtStart = this.currentTime
      for (const queue of this.queues.values()) queue.node.port.postMessage({ type: 'play' })
      this.startClock()
    } catch (error) {
      if (this.playing) {
        this.playing = false
        this.stateCallbacks.forEach((callback) => callback(false))
      }
      throw error
    }
  }

  pause(): void {
    if (!this.playing) return
    this.updateTime()
    this.playing = false
    for (const queue of this.queues.values()) queue.node.port.postMessage({ type: 'pause' })
    this.stopClock()
    this.stateCallbacks.forEach((callback) => callback(false))
  }

  async playPause(): Promise<void> {
    if (this.playing) this.pause()
    else await this.play()
  }

  seekTo(outputTime: number): void {
    this.suspendForRebuild()
    this.currentTime = Math.max(0, Math.min(this.duration, outputTime))
    this.timeCallbacks.forEach((callback) => callback(this.currentTime))
    void this.rebuildQueues(this.currentTime).catch((error) => this.emitError(error))
  }

  getCurrentTime(): number {
    this.updateTime()
    return this.currentTime
  }

  getDuration(): number {
    return this.duration
  }

  isPlaying(): boolean {
    return this.playing
  }

  getDiagnostics(): PlaybackDiagnostics {
    return { ...this.diagnostics }
  }

  onTimeUpdate(callback: (time: number) => void): () => void {
    this.timeCallbacks.add(callback)
    return () => this.timeCallbacks.delete(callback)
  }
  onPlayStateChange(callback: (playing: boolean) => void): () => void {
    this.stateCallbacks.add(callback)
    return () => this.stateCallbacks.delete(callback)
  }
  onDurationChange(callback: (duration: number) => void): () => void {
    this.durationCallbacks.add(callback)
    return () => this.durationCallbacks.delete(callback)
  }
  onEnded(callback: () => void): () => void {
    this.endedCallbacks.add(callback)
    return () => this.endedCallbacks.delete(callback)
  }
  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }

  destroy(): void {
    this.rebuildToken++
    this.pause()
    for (const queue of this.queues.values()) {
      queue.generation++
      queue.controller.abort()
      queue.node.disconnect()
      queue.gain.disconnect()
    }
    this.queues.clear()
    this.providers.clear()
    void this.context?.close()
    this.context = null
  }

  private async ensureContext(): Promise<void> {
    if (this.context) return
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE })
    if (this.context.sampleRate !== SAMPLE_RATE) {
      await this.context.close()
      this.context = null
      throw new Error('Audio device could not create the required 48000 Hz context')
    }
    const blobUrl = URL.createObjectURL(
      new Blob([WORKLET_CODE], { type: 'application/javascript' }),
    )
    try {
      await this.context.audioWorklet.addModule(blobUrl)
    } catch (error) {
      await this.context.close()
      this.context = null
      throw error
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  private async rebuildQueues(fromTime: number): Promise<void> {
    const rebuildToken = ++this.rebuildToken
    await this.ensureContext()
    if (rebuildToken !== this.rebuildToken) return
    for (const queue of this.queues.values()) {
      queue.generation++
      queue.controller.abort()
      queue.node.disconnect()
      queue.gain.disconnect()
    }
    this.queues.clear()
    const anySolo = this.tracks.some((track) => track.solo)
    for (const track of this.tracks) {
      const channelCount = Math.max(
        1,
        ...track.clips.map((clip) => this.providers.get(clip.audioSourceId)?.channels ?? 1),
      )
      const node = new AudioWorkletNode(this.context!, 'podcut-player', {
        numberOfOutputs: 1,
        outputChannelCount: [channelCount],
        processorOptions: {
          maxFrames: MAX_FRAMES,
          targetFrames: TARGET_FRAMES,
          refillFrames: REFILL_FRAMES,
        },
      })
      const gain = this.context!.createGain()
      gain.gain.value = track.volume
      node.connect(gain)
      gain.connect(this.context!.destination)
      const queue: TrackQueue = {
        node,
        gain,
        generation: ++this.queueGeneration,
        queuedFrames: 0,
        plan: buildTrackPlaybackPlan(track, fromTime, this.duration, SAMPLE_RATE, anySolo),
        segmentIndex: 0,
        segmentOffset: 0,
        controller: new AbortController(),
        filling: false,
      }
      node.port.onmessage = ({ data }) => this.onQueueMessage(queue, data)
      node.port.postMessage({ type: 'flush', generation: queue.generation })
      this.queues.set(track.id, queue)
    }
    await Promise.all([...this.queues.values()].map((queue) => this.fill(queue)))
    if (rebuildToken === this.rebuildToken && this.playing) {
      if (this.context!.state === 'suspended') await this.context!.resume()
      if (rebuildToken !== this.rebuildToken || !this.playing) return
      for (const queue of this.queues.values()) queue.node.port.postMessage({ type: 'play' })
      this.positionAtStart = this.currentTime
      this.startedAt = null
      this.startClock()
    }
  }

  private onQueueMessage(queue: TrackQueue, data: Record<string, number | string>): void {
    if (data.generation !== queue.generation) return
    if (data.type === 'started' && this.startedAt === null && this.context) {
      this.startedAt = this.context.currentTime
    } else if (data.type === 'depth' || data.type === 'need-data') {
      queue.queuedFrames = Number(data.queuedFrames)
      this.diagnostics.maximumQueuedFrames = Math.max(
        this.diagnostics.maximumQueuedFrames,
        queue.queuedFrames,
      )
      if (data.type === 'need-data') void this.fill(queue).catch((error) => this.emitError(error))
    } else if (data.type === 'underrun') {
      this.diagnostics.underruns++
    } else if (data.type === 'overflow') {
      this.emitError(new Error('AudioWorklet queue exceeded its hard maximum'))
    }
  }

  private async fill(queue: TrackQueue): Promise<void> {
    if (queue.filling) return
    queue.filling = true
    const generation = queue.generation
    try {
      while (queue.queuedFrames < TARGET_FRAMES && queue.segmentIndex < queue.plan.length) {
        const segment = queue.plan[queue.segmentIndex]
        const remaining = segment.frameCount - queue.segmentOffset
        const count = Math.min(
          READ_FRAMES,
          remaining,
          TARGET_FRAMES - queue.queuedFrames,
          MAX_FRAMES - queue.queuedFrames,
        )
        if (count <= 0) break
        let channels: Float32Array[]
        let gain = 1
        if (segment.kind === 'silence') {
          channels = [new Float32Array(count)]
        } else {
          const provider = this.providers.get(segment.audioSourceId)
          if (!provider) throw new Error(`Missing PCM provider for ${segment.audioSourceId}`)
          const chunk = await provider.readFrames(
            segment.sourceFrame + queue.segmentOffset,
            count,
            queue.controller.signal,
          )
          if (generation !== queue.generation) return
          if (
            !Number.isInteger(chunk.frameCount) ||
            chunk.frameCount < 0 ||
            chunk.frameCount > count
          )
            throw new Error('PCM provider returned an invalid frame count')
          if (
            chunk.channels.length !== provider.channels ||
            chunk.channels.some((channel) => channel.length !== chunk.frameCount)
          )
            throw new Error('PCM provider returned an invalid channel layout')
          channels = Array.from({ length: provider.channels }, (_, channelIndex) => {
            const source = chunk.channels[channelIndex]
            if (chunk.frameCount === count && source?.length === count) return source
            const padded = new Float32Array(count)
            if (source)
              padded.set(source.subarray(0, Math.min(source.length, chunk.frameCount, count)))
            return padded
          })
          gain = segment.gain
          this.diagnostics.maximumReadFrames = Math.max(this.diagnostics.maximumReadFrames, count)
        }
        sendPcmChunk(queue.node.port, { type: 'pcm', generation, channels, gain })
        queue.queuedFrames += count
        queue.segmentOffset += count
        if (queue.segmentOffset === segment.frameCount) {
          queue.segmentIndex++
          queue.segmentOffset = 0
        }
      }
      if (queue.segmentIndex === queue.plan.length) {
        queue.node.port.postMessage({ type: 'end', generation })
      }
    } finally {
      queue.filling = false
    }
  }

  private updateTime(): void {
    if (!this.playing || this.startedAt === null || !this.context) return
    this.currentTime = Math.min(
      this.duration,
      this.positionAtStart + this.context.currentTime - this.startedAt,
    )
  }

  private suspendForRebuild(): void {
    if (this.playing) this.updateTime()
    for (const queue of this.queues.values()) queue.node.port.postMessage({ type: 'pause' })
    this.positionAtStart = this.currentTime
    this.startedAt = null
    this.stopClock()
  }

  private startClock(): void {
    this.stopClock()
    const tick = () => {
      if (!this.playing) return
      this.updateTime()
      this.timeCallbacks.forEach((callback) => callback(this.currentTime))
      if (this.currentTime >= this.duration) {
        this.playing = false
        this.stateCallbacks.forEach((callback) => callback(false))
        this.endedCallbacks.forEach((callback) => callback())
        return
      }
      this.animationFrame = requestAnimationFrame(tick)
    }
    this.animationFrame = requestAnimationFrame(tick)
  }

  private stopClock(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
  }

  private emitError(error: unknown): void {
    if (error instanceof Error && error.name === 'AbortError') return
    const resolved = error instanceof Error ? error : new Error(String(error))
    this.errorCallbacks.forEach((callback) => callback(resolved))
  }
}

function hasSamePlaybackStructure(previous: Track[], next: Track[]): boolean {
  if (previous.length !== next.length) return false
  return previous.every((track, index) => {
    const candidate = next[index]
    if (
      track.id !== candidate.id ||
      track.muted !== candidate.muted ||
      track.solo !== candidate.solo ||
      track.clips.length !== candidate.clips.length
    )
      return false
    return track.clips.every((clip, clipIndex) => {
      const other = candidate.clips[clipIndex]
      return (
        clip.id === other.id &&
        clip.audioSourceId === other.audioSourceId &&
        clip.sourceStart === other.sourceStart &&
        clip.sourceEnd === other.sourceEnd &&
        clip.outputStart === other.outputStart &&
        clip.gain === other.gain &&
        clip.muted === other.muted
      )
    })
  })
}
