import { hasSamePlaybackStructure } from './PlaybackStructure'
import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import type {
  AudioSampleProvider,
  RenderAudioPlayer,
  PlaybackMode,
  PlaybackDiagnostics,
} from '@shared/PlayerTypes'
import { WORKLET_CODE, sendPcmChunk } from './AudioPlayerWorklet'
import { buildAudioRenderPlan } from '@shared/audio/AudioRenderPlanBuilder'
import type { TrackRenderPlan } from '@shared/audio/AudioRenderPlan'
import { renderTrackBlock } from './TrackBlockRenderer'

const SAMPLE_RATE = 48_000
const TARGET_FRAMES = SAMPLE_RATE * 2
const REFILL_FRAMES = SAMPLE_RATE * 1.5
const MAX_FRAMES = SAMPLE_RATE * 3
const READ_FRAMES = 4096

interface TrackQueue {
  node: AudioWorkletNode
  gain: GainNode
  generation: number
  sentFrames: number
  acknowledgedFrames: number
  queuedFrames: number
  plannedFrames: number
  plan: TrackRenderPlan
  outputFrame: number
  endFrame: number
  controller: AbortController
  filling: boolean
  prefillWaiter: PrefillWaiter | null
}

interface PrefillWaiter {
  generation: number
  resolve: () => void
  reject: (error: Error) => void
}

export class WorkletAudioPlayer implements RenderAudioPlayer {
  private context: AudioContext | null = null
  private contextInitialization: Promise<void> | null = null
  private contextLifecycle = 0
  private destroyed = false
  private destruction: Promise<void> | null = null
  private providers = new Map<AudioSourceId, AudioSampleProvider>()
  private tracks: Track[] = []
  private mode: PlaybackMode = 'timeline'
  private planMode: PlaybackMode = 'timeline'
  private renderPlan = buildAudioRenderPlan([], 'timeline')
  private queues = new Map<string, TrackQueue>()
  private playing = false
  private currentTime = 0
  private duration = 0
  private startedAt: number | null = null
  private awaitingStart = false
  private playIntent = 0
  private playbackStartId = 0
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
    if (this.destroyed) throw createAbortError()
    if (id !== samples.audioSourceId) throw new Error('Audio source provider identity mismatch')
    if (samples.sampleRate !== SAMPLE_RATE) throw new Error('Audio source cache must use 48000 Hz')
    this.providers.set(id, samples)
  }

  removeAudioSource(id: AudioSourceId): void {
    this.providers.delete(id)
  }

  setTracks(tracks: Track[]): void {
    if (this.destroyed) return
    const volumeOnlyChange =
      this.planMode === this.mode && hasSamePlaybackStructure(this.tracks, tracks)
    if (this.context && !volumeOnlyChange) this.suspendForRebuild()
    this.planMode = this.mode
    this.tracks = tracks
    if (volumeOnlyChange) {
      for (const track of tracks) {
        const queue = this.queues.get(track.id)
        if (queue) queue.gain.gain.value = track.volume
      }
      return
    }
    this.renderPlan = buildAudioRenderPlan(tracks, this.mode)
    const nextDuration = this.renderPlan.durationFrames / SAMPLE_RATE
    if (nextDuration !== this.duration) {
      this.duration = nextDuration
      this.durationCallbacks.forEach((callback) => callback(nextDuration))
    }
    if (this.context) {
      this.currentTime = Math.min(this.currentTime, this.duration)
      void this.rebuildQueues(this.currentTime).catch((error) => this.emitError(error))
    }
  }

  setPlaybackMode(mode: PlaybackMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.setTracks(this.tracks)
  }

  async play(): Promise<void> {
    if (this.destroyed) return
    if (this.playing) return
    const playIntent = ++this.playIntent
    this.startedAt = null
    this.awaitingStart = false
    this.playing = true
    this.stateCallbacks.forEach((callback) => callback(true))
    const lifecycleToken = this.rebuildToken
    try {
      await this.ensureContext()
      if (playIntent !== this.playIntent || lifecycleToken !== this.rebuildToken || !this.playing)
        return
      if (this.queues.size === 0) {
        await this.rebuildQueues(this.currentTime)
        return
      }
      const rebuildToken = this.rebuildToken
      await Promise.all([...this.queues.values()].map((queue) => this.fill(queue)))
      if (playIntent !== this.playIntent || rebuildToken !== this.rebuildToken || !this.playing)
        return
      await Promise.all([...this.queues.values()].map((queue) => this.waitForPrefill(queue)))
      if (playIntent !== this.playIntent || rebuildToken !== this.rebuildToken || !this.playing)
        return
      if (this.context!.state === 'suspended') await this.context!.resume()
      if (playIntent !== this.playIntent || rebuildToken !== this.rebuildToken || !this.playing)
        return
      this.startedAt = null
      this.positionAtStart = this.currentTime
      this.postPlay()
      this.startClock()
    } catch (error) {
      if (playIntent !== this.playIntent || isAbortError(error)) return
      if (this.playing) {
        this.playing = false
        this.stateCallbacks.forEach((callback) => callback(false))
      }
      throw error
    }
  }

  pause(): void {
    if (!this.playing) return
    this.playIntent++
    this.updateTime()
    this.startedAt = null
    this.awaitingStart = false
    this.playing = false
    for (const queue of this.queues.values()) {
      this.cancelPrefill(queue)
      queue.node.port.postMessage({ type: 'pause' })
    }
    this.stopClock()
    this.stateCallbacks.forEach((callback) => callback(false))
  }

  async playPause(): Promise<void> {
    if (this.playing) this.pause()
    else await this.play()
  }

  seekTo(outputTime: number): void {
    if (this.destroyed) return
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

  destroy(): Promise<void> {
    if (this.destruction) return this.destruction
    this.destroyed = true
    this.rebuildToken++
    this.contextLifecycle++
    this.pause()
    for (const queue of this.queues.values()) {
      this.cancelPrefill(queue)
      queue.generation++
      queue.controller.abort()
      queue.node.disconnect()
      queue.gain.disconnect()
    }
    this.queues.clear()
    this.providers.clear()
    const context = this.context
    const initialization = this.contextInitialization
    this.context = null
    const teardown = [context ? Promise.resolve().then(() => context.close()) : Promise.resolve()]
    if (initialization) teardown.push(initialization)
    this.destruction = Promise.allSettled(teardown).then((results) => {
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected' && !isAbortError(result.reason),
      )
      if (failure) throw failure.reason
    })
    return this.destruction
  }

  private async ensureContext(): Promise<void> {
    if (this.destroyed) throw createAbortError()
    if (this.context) return
    let initialization = this.contextInitialization
    if (!initialization) {
      const context = new AudioContext({ sampleRate: SAMPLE_RATE })
      initialization = this.initializeContext(context, this.contextLifecycle)
      this.contextInitialization = initialization
    }
    try {
      await initialization
    } finally {
      if (this.contextInitialization === initialization) this.contextInitialization = null
    }
  }

  private async initializeContext(context: AudioContext, lifecycle: number): Promise<void> {
    if (context.sampleRate !== SAMPLE_RATE) {
      await context.close()
      throw new Error('Audio device could not create the required 48000 Hz context')
    }
    const blobUrl = URL.createObjectURL(
      new Blob([WORKLET_CODE], { type: 'application/javascript' }),
    )
    try {
      await context.audioWorklet.addModule(blobUrl)
      if (this.destroyed || lifecycle !== this.contextLifecycle) throw createAbortError()
      this.context = context
    } catch (error) {
      await context.close()
      throw error
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  private async rebuildQueues(fromTime: number): Promise<void> {
    const rebuildToken = ++this.rebuildToken
    const playIntent = this.playIntent
    await this.ensureContext()
    if (rebuildToken !== this.rebuildToken) return
    for (const queue of this.queues.values()) {
      this.cancelPrefill(queue)
      queue.generation++
      queue.controller.abort()
      queue.node.disconnect()
      queue.gain.disconnect()
    }
    this.queues.clear()
    for (const track of this.tracks) {
      const channelCount = Math.max(
        1,
        ...track.clips.map((clip) => this.providers.get(clip.audioSourceId)?.channels ?? 1),
      )
      const node = new AudioWorkletNode(this.context!, 'redencut-player', {
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
      const plan = this.renderPlan.tracks.find((candidate) => candidate.trackId === track.id) ?? {
        trackId: track.id,
        volume: track.volume,
        contributions: [],
      }
      const queue: TrackQueue = {
        node,
        gain,
        generation: ++this.queueGeneration,
        sentFrames: 0,
        acknowledgedFrames: 0,
        queuedFrames: 0,
        plannedFrames: Math.max(
          0,
          this.renderPlan.durationFrames - Math.round(fromTime * SAMPLE_RATE),
        ),
        plan,
        outputFrame: Math.round(fromTime * SAMPLE_RATE),
        endFrame: this.renderPlan.durationFrames,
        controller: new AbortController(),
        filling: false,
        prefillWaiter: null,
      }
      node.port.onmessage = ({ data }) => this.onQueueMessage(queue, data)
      node.port.postMessage({ type: 'flush', generation: queue.generation })
      this.queues.set(track.id, queue)
    }
    await Promise.all([...this.queues.values()].map((queue) => this.fill(queue)))
    if (playIntent !== this.playIntent || rebuildToken !== this.rebuildToken || !this.playing)
      return
    await Promise.all([...this.queues.values()].map((queue) => this.waitForPrefill(queue)))
    if (playIntent === this.playIntent && rebuildToken === this.rebuildToken && this.playing) {
      if (this.context!.state === 'suspended') await this.context!.resume()
      if (playIntent !== this.playIntent || rebuildToken !== this.rebuildToken || !this.playing)
        return
      this.postPlay()
      this.positionAtStart = this.currentTime
      this.startedAt = null
      this.startClock()
    }
  }

  private postPlay(): void {
    this.awaitingStart = true
    const startId = ++this.playbackStartId
    for (const queue of this.queues.values()) queue.node.port.postMessage({ type: 'play', startId })
  }

  private onQueueMessage(queue: TrackQueue, data: Record<string, number | string>): void {
    if (data.generation !== queue.generation) return
    if (
      data.type === 'started' &&
      data.startId === this.playbackStartId &&
      this.playing &&
      this.awaitingStart &&
      this.context
    ) {
      this.awaitingStart = false
      this.startedAt = this.context.currentTime
    } else if (data.type === 'depth' || data.type === 'need-data') {
      queue.queuedFrames = Number(data.queuedFrames)
      if (data.type === 'depth') {
        const acceptedFrames = Number(data.acceptedFrames)
        if (Number.isFinite(acceptedFrames)) {
          queue.acknowledgedFrames = Math.min(
            queue.sentFrames,
            Math.max(queue.acknowledgedFrames, acceptedFrames),
          )
        }
        this.resolvePrefill(queue)
        this.continuePrefill(queue)
      }
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
      while (
        queue.queuedFrames + this.inFlightFrames(queue) < TARGET_FRAMES &&
        queue.outputFrame < queue.endFrame
      ) {
        const remaining = queue.endFrame - queue.outputFrame
        const count = Math.min(
          READ_FRAMES,
          remaining,
          TARGET_FRAMES - queue.queuedFrames - this.inFlightFrames(queue),
          MAX_FRAMES - queue.queuedFrames - this.inFlightFrames(queue),
        )
        if (count <= 0) break
        const channels = await renderTrackBlock(
          queue.plan,
          queue.outputFrame,
          count,
          this.providers,
          queue.controller.signal,
        )
        if (generation !== queue.generation) return
        this.diagnostics.maximumReadFrames = Math.max(this.diagnostics.maximumReadFrames, count)
        sendPcmChunk(queue.node.port, { type: 'pcm', generation, channels, gain: 1 })
        queue.sentFrames += count
        queue.outputFrame += count
      }
      if (queue.outputFrame >= queue.endFrame) {
        queue.node.port.postMessage({ type: 'end', generation })
      }
    } catch (error) {
      const waiter = queue.prefillWaiter
      if (waiter?.generation === generation) {
        queue.prefillWaiter = null
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
      throw error
    } finally {
      queue.filling = false
      this.continuePrefill(queue)
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
    this.rebuildToken++
    if (this.playing) this.updateTime()
    for (const queue of this.queues.values()) {
      this.cancelPrefill(queue)
      queue.node.port.postMessage({ type: 'pause' })
    }
    this.positionAtStart = this.currentTime
    this.startedAt = null
    this.awaitingStart = false
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
    if (isAbortError(error)) return
    const resolved = error instanceof Error ? error : new Error(String(error))
    this.errorCallbacks.forEach((callback) => callback(resolved))
  }

  private inFlightFrames(queue: TrackQueue): number {
    return queue.sentFrames - queue.acknowledgedFrames
  }

  private waitForPrefill(queue: TrackQueue): Promise<void> {
    if (this.isPrefilled(queue)) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      queue.prefillWaiter = { generation: queue.generation, resolve, reject }
      this.continuePrefill(queue)
    })
  }

  private continuePrefill(queue: TrackQueue): void {
    // Depth can arrive after playback consumed frames, leaving the paused queue above
    // the worklet refill watermark but below our start target. Pump that gap explicitly.
    if (
      !queue.prefillWaiter ||
      queue.filling ||
      queue.outputFrame >= queue.endFrame ||
      queue.queuedFrames + this.inFlightFrames(queue) >= TARGET_FRAMES
    )
      return
    const waiter = queue.prefillWaiter
    void this.fill(queue).catch((error: unknown) => {
      if (queue.prefillWaiter === waiter) {
        queue.prefillWaiter = null
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private resolvePrefill(queue: TrackQueue): void {
    const waiter = queue.prefillWaiter
    if (!waiter || waiter.generation !== queue.generation || !this.isPrefilled(queue)) return
    queue.prefillWaiter = null
    waiter.resolve()
  }

  private cancelPrefill(queue: TrackQueue): void {
    const waiter = queue.prefillWaiter
    if (!waiter) return
    queue.prefillWaiter = null
    waiter.reject(createAbortError())
  }

  private isPrefilled(queue: TrackQueue): boolean {
    // A resumed queue may already have consumed most of its original plan.
    // Only remaining frames need prefill, but in-flight PCM still needs acknowledgement.
    const consumedFrames = queue.acknowledgedFrames - queue.queuedFrames
    const remainingFrames = Math.max(0, queue.plannedFrames - consumedFrames)
    return queue.queuedFrames >= Math.min(TARGET_FRAMES, remainingFrames)
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

function createAbortError(): Error {
  const error = new Error('AudioWorklet prefill was cancelled')
  error.name = 'AbortError'
  return error
}
