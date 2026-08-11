// ─────────────────────────────────────────────────────────────────────────────
// WebCodecsPlayer — Phase 2 IAudioPlayer (multi-source)
//
// Frame-accurate non-linear playback via WebCodecs AudioDecoder + AudioWorklet.
//
// Key advantage over SimpleAudioPlayer:
//   True skip at cut boundaries — the decode loop physically skips to the
//   byte offset of the next clip instead of playing through silenced audio.
//
// Multi-source architecture (Phase 3):
//   Each registered source gets its own AudioWorkletNode → GainNode → destination
//   chain and its own independent decode loop.  All worklets share one AudioContext
//   so they are clocked by the same hardware oscillator and start draining
//   simultaneously when play() opens all their gates.
//
// Data flow (per source):
//
//   FrameIndex.seek(t)                    — maps seek time → byte offset
//        ↓
//   fetch(url, Range: bytes=X-Y)          — fetch compressed audio bytes
//        ↓
//   AudioDecoder.decode(EncodedAudioChunk) — WebCodecs decodes to PCM
//        ↓
//   output callback → sendPcmChunk()      — zero-copy transfer to worklet
//        ↓
//   PodCutPlayerProcessor.process()       — drains queue into Web Audio output
//        ↓
//   GainNode                              — per-source volume control
//        ↓
//   AudioContext.destination              — mixed output
//
// Clock: we track currentTime via AudioContext.currentTime delta since play().
// This is jitter-free and decoupled from the decode pipeline latency.
//
// Seek:
//   1. pause all decode loops + flush all worklets
//   2. reposition _currentTime
//   3. restart all decode loops from the nearest frame boundary
//
// Supported codecs: MP3, AAC/M4A, Opus, FLAC (via AudioDecoder.isConfigSupported)
// Falls back gracefully: if a codec isn't supported, loadSourceFile rejects,
// and App.tsx should fall back to SimpleAudioPlayer.
// ─────────────────────────────────────────────────────────────────────────────

import type { IAudioPlayer } from '@shared/player.types'
import type { Track } from '@shared/project.types'
import { buildFrameIndex, type FrameIndex } from './FrameIndex'
import { WORKLET_CODE, sendPcmChunk } from './AudioPlayerWorklet'
import { buildSegmentsForSource, type Segment } from './buildSegments'

// ── WAV PCM descriptor ────────────────────────────────────────────────────────

interface WavInfo {
  channels: number
  sampleRate: number
  bitDepth: number // 16, 24, or 32
  isFloat: boolean // true when AudioFormat == 3 (32-bit IEEE float)
  dataOffset: number // byte position of the first PCM sample in the file
  bytesPerFrame: number // channels × (bitDepth / 8) — one sample per channel
  totalBytes: number // total file size (for exact duration)
}

/**
 * Fetch the first 256 bytes of a WAV file and parse the fmt/data chunk headers.
 * 256 bytes is enough to cover a standard 44-byte PCM header plus any LIST/INFO
 * metadata that some encoders insert before the data chunk.
 */
async function parseWavInfo(url: string): Promise<WavInfo> {
  const resp = await fetch(url, { headers: { Range: 'bytes=0-255' } })

  const contentRange = resp.headers.get('content-range') ?? ''
  const crMatch = contentRange.match(/\/(\d+)$/)
  let totalBytes = crMatch
    ? parseInt(crMatch[1])
    : parseInt(resp.headers.get('content-length') ?? '0')

  const reader = resp.body!.getReader()
  const scratch = new Uint8Array(256)
  let bytesRead = 0
  while (bytesRead < 256) {
    const { done, value } = await reader.read()
    if (done || !value) break
    const toCopy = Math.min(value.length, 256 - bytesRead)
    scratch.set(value.subarray(0, toCopy), bytesRead)
    bytesRead += toCopy
  }
  reader.cancel().catch(() => {})

  if (bytesRead < 36) {
    throw new Error(`[WebCodecsPlayer] WAV header too short: only ${bytesRead} bytes readable`)
  }

  const buf = scratch.subarray(0, bytesRead)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // RIFF chunk-size fallback: Electron's net.fetch often omits Content-Length
  if (totalBytes === 0 && bytesRead >= 8) {
    totalBytes = view.getUint32(4, true) + 8
  }

  const audioFormat = view.getUint16(20, true)
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bitDepth = view.getUint16(34, true)

  let dataOffset = 12
  while (dataOffset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(
      buf[dataOffset],
      buf[dataOffset + 1],
      buf[dataOffset + 2],
      buf[dataOffset + 3],
    )
    const chunkSize = view.getUint32(dataOffset + 4, true)
    dataOffset += 8
    if (id === 'data') break
    dataOffset += chunkSize + (chunkSize & 1)
  }

  return {
    channels,
    sampleRate,
    bitDepth,
    isFloat: audioFormat === 3,
    dataOffset,
    bytesPerFrame: channels * (bitDepth / 8),
    totalBytes,
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FETCH_CHUNK = 32_768
const TARGET_BUFFER_SECS = 2.0

// ── Codec config helpers ──────────────────────────────────────────────────────

interface CodecConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  extra?: Record<string, unknown>
}

function guessCodecConfig(url: string, sampleRate: number): CodecConfig {
  const lower = url.toLowerCase()
  if (lower.includes('.m4a') || lower.includes('.aac')) {
    return {
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: 2,
      extra: { aac: { format: 'adts' } },
    }
  }
  if (lower.includes('.opus')) return { codec: 'opus', sampleRate, numberOfChannels: 2 }
  if (lower.includes('.flac')) return { codec: 'flac', sampleRate, numberOfChannels: 2 }
  return { codec: 'mp3', sampleRate, numberOfChannels: 2 }
}

// ── Source registry entry ─────────────────────────────────────────────────────
//
// Each registered audio source owns its own slice of the Web Audio graph
// (AudioWorkletNode → GainNode → destination) and its own decode pipeline
// (AudioDecoder, AbortController, bufferedAhead counter).
//
// Sharing one AudioContext across all sources guarantees that all worklets
// start draining on the same hardware clock tick — the foundation of
// multi-source synchronisation.

interface SourceEntry {
  url: string
  index: FrameIndex
  codec: CodecConfig
  duration: number
  wavInfo?: WavInfo

  // Per-source Web Audio graph (wired during loadSourceFile)
  worklet: AudioWorkletNode | null
  gainNode: GainNode | null

  // Per-source decode pipeline
  decoder: AudioDecoder | null
  decodeCtrl: AbortController | null
  bufferedAhead: number
}

// ── WebCodecsPlayer ───────────────────────────────────────────────────────────

export class WebCodecsPlayer implements IAudioPlayer {
  // ── Shared AudioContext ────────────────────────────────────────────────────
  private ctx: AudioContext | null = null
  private _workletModuleLoaded = false

  // ── Source registry ────────────────────────────────────────────────────────
  private sources = new Map<string, SourceEntry>()
  private primarySourceId: string | null = null

  // ── Track model ────────────────────────────────────────────────────────────
  private tracks: Track[] = []
  private _tracksStructuralKey = ''

  // ── Playback state ─────────────────────────────────────────────────────────
  private _isPlaying = false
  private _currentTime = 0
  private _duration = 0

  // Clock: AudioContext time when the primary worklet first drains real audio
  private _ctxTimeAtPlay: number | null = null
  private _posAtPlay: number = 0

  // ── rAF handle ────────────────────────────────────────────────────────────
  private _rafId: number | null = null

  // ── Callbacks ──────────────────────────────────────────────────────────────
  private timeUpdateCbs = new Set<(t: number) => void>()
  private playStateCbs = new Set<(p: boolean) => void>()
  private durationChangeCbs = new Set<(d: number) => void>()
  private endedCbs = new Set<() => void>()

  // ── AudioContext management ────────────────────────────────────────────────

  /**
   * Ensure a live AudioContext exists.  Pass `sampleRate` for the PRIMARY source
   * only — it sets the native rate so decoded PCM plays at the correct pitch.
   * Secondary sources reuse the existing context without changing its rate.
   */
  private async ensureCtx(sampleRate?: number): Promise<AudioContext> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (sampleRate && this.ctx.sampleRate !== sampleRate) {
        // Tear down all per-source Web Audio nodes before closing the context
        for (const entry of this.sources.values()) {
          entry.worklet?.disconnect()
          entry.gainNode?.disconnect()
          entry.worklet = null
          entry.gainNode = null
          entry.decodeCtrl?.abort()
          entry.decodeCtrl = null
          entry.bufferedAhead = 0
        }
        this._workletModuleLoaded = false
        await this.ctx.close()
        this.ctx = null
      } else {
        return this.ctx
      }
    }
    this.ctx = new AudioContext(sampleRate ? { sampleRate } : undefined)
    return this.ctx
  }

  /**
   * Register the AudioWorklet processor module on the current AudioContext.
   * The module is registered once per context lifetime; subsequent calls are no-ops.
   */
  private async ensureWorkletModule(): Promise<void> {
    if (!this.ctx || this._workletModuleLoaded) return
    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    try {
      await this.ctx.audioWorklet.addModule(blobUrl)
      this._workletModuleLoaded = true
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  /**
   * Create and wire one AudioWorkletNode + GainNode for a source.
   * The primary source's worklet also wires the 'started' callback that zeroes
   * the AudioContext clock when real audio first drains.
   */
  private createSourceWorklet(entry: SourceEntry, isPrimary: boolean): void {
    if (!this.ctx) return
    const workletNode = new AudioWorkletNode(this.ctx, 'podcut-player', {
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const gainNode = this.ctx.createGain()
    gainNode.gain.value = 1
    workletNode.connect(gainNode)
    gainNode.connect(this.ctx.destination)

    if (isPrimary) {
      workletNode.port.onmessage = ({ data }) => {
        if (data.type === 'started' && this._isPlaying && this.ctx) {
          this._ctxTimeAtPlay = this.ctx.currentTime
        }
      }
    }

    entry.worklet = workletNode
    entry.gainNode = gainNode
  }

  // ── IAudioPlayer — loadSourceFile ─────────────────────────────────────────

  async loadSourceFile(id: string, filePath: string): Promise<void> {
    if (this.sources.has(id)) return

    const url = `podcut://localhost/${encodeURIComponent(filePath)}`

    const index = await buildFrameIndex(url)
    const isPrimary = !this.primarySourceId

    // ── WAV: raw PCM path ──────────────────────────────────────────────────
    if (url.toLowerCase().includes('.wav')) {
      let wavInfo: WavInfo
      try {
        wavInfo = await parseWavInfo(url)
      } catch (err) {
        console.error('[WebCodecsPlayer] parseWavInfo failed:', err)
        throw err
      }

      try {
        await this.ensureCtx(isPrimary ? wavInfo.sampleRate : undefined)
        await this.ensureWorkletModule()
      } catch (err) {
        console.error('[WebCodecsPlayer] ensureCtx/worklet failed:', err)
        throw err
      }

      const pcmBytes = wavInfo.totalBytes - wavInfo.dataOffset
      const duration = pcmBytes / (wavInfo.sampleRate * wavInfo.bytesPerFrame)
      const codec: CodecConfig = {
        codec: 'pcm',
        sampleRate: wavInfo.sampleRate,
        numberOfChannels: wavInfo.channels,
      }

      const entry: SourceEntry = {
        url,
        index,
        codec,
        duration,
        wavInfo,
        worklet: null,
        gainNode: null,
        decoder: null,
        decodeCtrl: null,
        bufferedAhead: 0,
      }
      this.sources.set(id, entry)
      this.createSourceWorklet(entry, isPrimary)

      if (isPrimary) {
        this.primarySourceId = id
      }
      // Seed: expand _duration to this source's length as a lower bound.
      // setTracks() derives the accurate duration from clip extents once tracks are set.
      if (duration > this._duration) {
        this._duration = duration
        this.durationChangeCbs.forEach((cb) => cb(this._duration))
      }
      this.startSourceDecodeLoop(id, this._currentTime)
      return
    }

    // ── Compressed: AudioDecoder path ─────────────────────────────────────
    const sampleRate =
      index.frames.length > 1 ? Math.round((1 / index.frames[0].duration) * 1152) : 44100

    await this.ensureCtx(isPrimary ? sampleRate : undefined)
    await this.ensureWorkletModule()

    const codec = guessCodecConfig(url, sampleRate)
    const config: AudioDecoderConfig = {
      codec: codec.codec,
      sampleRate: codec.sampleRate,
      numberOfChannels: codec.numberOfChannels,
      ...(codec.extra ?? {}),
    }
    const support = await AudioDecoder.isConfigSupported(config)
    if (!support.supported) {
      throw new Error(
        `[WebCodecsPlayer] codec '${codec.codec}' not supported — use SimpleAudioPlayer`,
      )
    }

    const lastFrame = index.frames[index.frames.length - 1]
    const duration = lastFrame ? lastFrame.time + lastFrame.duration : 0

    const entry: SourceEntry = {
      url,
      index,
      codec,
      duration,
      worklet: null,
      gainNode: null,
      decoder: null,
      decodeCtrl: null,
      bufferedAhead: 0,
    }
    this.sources.set(id, entry)
    this.createSourceWorklet(entry, isPrimary)

    if (isPrimary) {
      this.primarySourceId = id
    }
    // Seed: expand _duration to this source's length as a lower bound.
    // setTracks() derives the accurate duration from clip extents once tracks are set.
    if (duration > this._duration) {
      this._duration = duration
      this.durationChangeCbs.forEach((cb) => cb(this._duration))
    }

    this.startSourceDecodeLoop(id, this._currentTime)
  }

  // ── IAudioPlayer — setTracks ──────────────────────────────────────────────

  setTracks(tracks: Track[]): void {
    this.tracks = tracks

    // Apply per-track volume to each source's gain node.
    // Each source is controlled by the volume of its associated track.
    if (this.ctx) {
      for (const [sourceId, entry] of this.sources.entries()) {
        if (!entry.gainNode) continue
        const track = tracks.find((t) => t.clips.some((c) => c.sourceFileId === sourceId))
        const volume = track?.volume ?? 1
        entry.gainNode.gain.setValueAtTime(volume, this.ctx.currentTime)
      }
    }

    // Derive accurate total duration from clip output extents.
    // This is more correct than source file lengths: a clip placed at a later
    // outputStart extends the timeline beyond any individual source's duration.
    const clipMaxEnd = tracks
      .flatMap((t) => t.clips)
      .reduce((max, c) => Math.max(max, c.outputStart + (c.sourceEnd - c.sourceStart)), 0)
    if (clipMaxEnd > 0 && clipMaxEnd !== this._duration) {
      this._duration = clipMaxEnd
      this.durationChangeCbs.forEach((cb) => cb(this._duration))
    }

    // Only restart decode loops when track structure changes (not for volume-only updates).
    // Restarting flushes the AudioWorklet FIFO — unnecessary for gain changes.
    const structuralKey = JSON.stringify(
      this.tracks.map((t) => ({
        id: t.id,
        muted: t.muted,
        solo: t.solo,
        clips: t.clips,
      })),
    )
    if (structuralKey !== this._tracksStructuralKey) {
      this._tracksStructuralKey = structuralKey
      this.restartAllDecodeLoops(this._currentTime)
    }
  }

  // ── IAudioPlayer — playback control ──────────────────────────────────────

  async play(): Promise<void> {
    if (this._isPlaying) return
    const ctx = await this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    this._isPlaying = true
    this._ctxTimeAtPlay = null // set by primary worklet's 'started' callback
    this._posAtPlay = this._currentTime

    // Open the gate on ALL worklets simultaneously — they all start draining
    // their pre-buffered queues at the same hardware clock tick.
    for (const entry of this.sources.values()) {
      entry.worklet?.port.postMessage({ type: 'play' })
    }

    this.emitPlayState(true)
    this.startRaf()

    // Ensure all sources have running decode loops (may be idle after initial load)
    for (const [sourceId, entry] of this.sources) {
      if (!entry.decodeCtrl) {
        this.startSourceDecodeLoop(sourceId, this._currentTime)
      }
    }
  }

  pause(): void {
    if (!this._isPlaying) return
    for (const entry of this.sources.values()) {
      entry.worklet?.port.postMessage({ type: 'pause' })
    }
    this.stopRaf()
    this._isPlaying = false
    this._ctxTimeAtPlay = null
    this.emitPlayState(false)
    // Decode loops keep running to maintain pre-buffer warmth
  }

  async playPause(): Promise<void> {
    if (this._isPlaying) this.pause()
    else await this.play()
  }

  seekTo(outputTime: number): void {
    const clamped = Math.max(0, Math.min(outputTime, this._duration))

    const wasPlaying = this._isPlaying
    if (wasPlaying) {
      for (const entry of this.sources.values()) {
        entry.worklet?.port.postMessage({ type: 'pause' })
      }
      this.stopRaf()
      this._isPlaying = false
      this._ctxTimeAtPlay = null
      this.emitPlayState(false)
    }

    this._currentTime = clamped
    this._posAtPlay = clamped
    this._ctxTimeAtPlay = null

    for (const entry of this.sources.values()) {
      entry.worklet?.port.postMessage({ type: 'flush' })
      entry.bufferedAhead = 0
    }
    this.emitTimeUpdate(clamped)
    this.startAllDecodeLoops(clamped)

    if (wasPlaying) this.play().catch(console.error)
  }

  // ── IAudioPlayer — state queries ──────────────────────────────────────────

  getCurrentTime(): number {
    return this._currentTime
  }
  getDuration(): number {
    return this._duration
  }
  isPlaying(): boolean {
    return this._isPlaying
  }

  // ── IAudioPlayer — event subscriptions ───────────────────────────────────

  onTimeUpdate(cb: (t: number) => void): () => void {
    this.timeUpdateCbs.add(cb)
    return () => this.timeUpdateCbs.delete(cb)
  }
  onPlayStateChange(cb: (p: boolean) => void): () => void {
    this.playStateCbs.add(cb)
    return () => this.playStateCbs.delete(cb)
  }
  onDurationChange(cb: (d: number) => void): () => void {
    this.durationChangeCbs.add(cb)
    return () => this.durationChangeCbs.delete(cb)
  }
  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb)
    return () => this.endedCbs.delete(cb)
  }

  // ── IAudioPlayer — removeSourceFile ──────────────────────────────────────

  removeSourceFile(id: string): void {
    const entry = this.sources.get(id)
    if (!entry) return
    entry.decodeCtrl?.abort()
    entry.worklet?.disconnect()
    entry.gainNode?.disconnect()
    this.sources.delete(id)

    if (this.primarySourceId === id) {
      this.primarySourceId = null
      // Promote the next remaining source to primary so _ctxTimeAtPlay gets set
      // when audio starts draining, keeping the rAF clock anchor alive.
      const next = this.sources.entries().next()
      if (!next.done) {
        const [nextId, nextEntry] = next.value
        this.primarySourceId = nextId
        if (nextEntry.worklet) {
          nextEntry.worklet.port.onmessage = ({ data }) => {
            if (data.type === 'started' && this._isPlaying && this.ctx) {
              this._ctxTimeAtPlay = this.ctx.currentTime
            }
          }
        }
      }
    }
  }

  // ── IAudioPlayer — lifecycle ──────────────────────────────────────────────

  destroy(): void {
    this.pause()
    this.stopAllDecodeLoops()
    for (const entry of this.sources.values()) {
      entry.decoder?.close()
      entry.decoder = null
      entry.worklet?.disconnect()
      entry.worklet = null
      entry.gainNode?.disconnect()
      entry.gainNode = null
    }
    this.sources.clear()
    this.primarySourceId = null
    this._workletModuleLoaded = false
    this.tracks = []
    this.timeUpdateCbs.clear()
    this.playStateCbs.clear()
    this.durationChangeCbs.clear()
    this.endedCbs.clear()
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }

  // ── rAF loop — clock ─────────────────────────────────────────────────────

  private startRaf(): void {
    if (this._rafId !== null) return

    const tick = () => {
      if (!this._isPlaying || !this.ctx) return

      if (this._ctxTimeAtPlay !== null) {
        this._currentTime = this._posAtPlay + (this.ctx.currentTime - this._ctxTimeAtPlay)

        if (this._currentTime >= this._duration) {
          this._currentTime = this._duration
          this.emitTimeUpdate(this._currentTime)
          this._isPlaying = false
          for (const entry of this.sources.values()) {
            entry.worklet?.port.postMessage({ type: 'pause' })
          }
          this.stopAllDecodeLoops()
          this.stopRaf()
          this._ctxTimeAtPlay = null
          this.emitPlayState(false)
          this.endedCbs.forEach((cb) => cb())
          return
        }
      }

      this.emitTimeUpdate(this._currentTime)
      this._rafId = requestAnimationFrame(tick)
    }

    this._rafId = requestAnimationFrame(tick)
  }

  private stopRaf(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  // ── Per-source decode loop management ────────────────────────────────────

  private stopAllDecodeLoops(): void {
    for (const entry of this.sources.values()) {
      entry.decodeCtrl?.abort()
      entry.decodeCtrl = null
    }
  }

  private startSourceDecodeLoop(sourceId: string, fromTime: number): void {
    const entry = this.sources.get(sourceId)
    if (!entry) return
    entry.decodeCtrl?.abort()
    entry.bufferedAhead = 0
    const ctrl = new AbortController()
    entry.decodeCtrl = ctrl
    this.runDecodeLoop(sourceId, fromTime, ctrl.signal).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        console.error(`[WebCodecsPlayer] decode loop error (source ${sourceId}):`, err)
      }
    })
  }

  private startAllDecodeLoops(fromTime: number): void {
    for (const sourceId of this.sources.keys()) {
      this.startSourceDecodeLoop(sourceId, fromTime)
    }
  }

  private restartAllDecodeLoops(fromTime: number): void {
    for (const entry of this.sources.values()) {
      entry.worklet?.port.postMessage({ type: 'flush' })
      entry.bufferedAhead = 0
    }
    this.startAllDecodeLoops(fromTime)
  }

  // ── Core decode loop ──────────────────────────────────────────────────────
  //
  // Iterates the clip list for ONE source in output order.  Muted segments
  // feed silence so the FIFO stays time-aligned with the hardware clock.
  // Each source runs its own independent loop, all coordinated by the shared
  // AudioContext hardware clock.

  private async runDecodeLoop(
    sourceId: string,
    startTime: number,
    signal: AbortSignal,
  ): Promise<void> {
    const entry = this.sources.get(sourceId)
    if (!entry || !entry.worklet) return

    const segments: Segment[] = buildSegmentsForSource(
      sourceId,
      startTime,
      this.tracks,
      (t) => entry.index.seek(t),
      entry.duration,
      FETCH_CHUNK,
    )

    const sampleRate = entry.wavInfo?.sampleRate ?? entry.codec.sampleRate
    const numChannels = entry.wavInfo?.channels ?? entry.codec.numberOfChannels

    if (entry.wavInfo) {
      for (const seg of segments) {
        if (signal.aborted) break
        if (seg.muted) {
          await this.feedSilence(entry, seg.durationSecs, sampleRate, numChannels, signal)
          continue
        }
        await this.decodePcmBytesRange(entry, seg.startByte, seg.endByte, seg.sourceStart, signal)
      }
    } else {
      const dec = await this.openDecoder(entry)
      for (const seg of segments) {
        if (signal.aborted) break
        if (seg.muted) {
          await this.feedSilence(entry, seg.durationSecs, sampleRate, numChannels, signal)
          continue
        }
        await this.decodeBytesRange(entry, dec, seg.startByte, seg.endByte, seg.sourceStart, signal)
      }
      if (!signal.aborted) await dec.flush()
    }

    if (!signal.aborted) {
      entry.worklet.port.postMessage({ type: 'end' })
    }
  }

  // ── Silence feeder for muted segments ────────────────────────────────────

  private async feedSilence(
    entry: SourceEntry,
    durationSecs: number,
    sampleRate: number,
    numChannels: number,
    signal: AbortSignal,
  ): Promise<void> {
    const CHUNK_FRAMES = 4096
    let remaining = durationSecs

    while (remaining > 0 && !signal.aborted) {
      while (entry.bufferedAhead > TARGET_BUFFER_SECS && !signal.aborted) {
        await new Promise<void>((r) => setTimeout(r, 50))
        entry.bufferedAhead = Math.max(0, entry.bufferedAhead - 0.05)
      }
      if (signal.aborted) break

      const chunkDur = Math.min(CHUNK_FRAMES / sampleRate, remaining)
      const frames = Math.ceil(chunkDur * sampleRate)
      const channels = Array.from({ length: numChannels }, () => new Float32Array(frames))
      sendPcmChunk(entry.worklet!.port, { channels, timestamp: 0 })
      entry.bufferedAhead += chunkDur
      remaining -= chunkDur
    }
  }

  // ── AudioDecoder management ───────────────────────────────────────────────

  private async openDecoder(entry: SourceEntry): Promise<AudioDecoder> {
    if (entry.decoder && entry.decoder.state !== 'closed') {
      entry.decoder.close()
      entry.decoder = null
    }

    const workletPort = entry.worklet!.port
    let decoderError: Error | null = null

    const decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        const ch = audioData.numberOfChannels
        const len = audioData.numberOfFrames
        const ts = audioData.timestamp / 1_000_000

        const channels: Float32Array[] = []
        for (let c = 0; c < ch; c++) {
          const buf = new Float32Array(len)
          audioData.copyTo(buf, { planeIndex: c, format: 'f32-planar' })
          channels.push(buf)
        }
        audioData.close()

        entry.bufferedAhead += len / (entry.codec.sampleRate || 44100)
        sendPcmChunk(workletPort, { channels, timestamp: ts })
      },
      error: (e: DOMException) => {
        decoderError = new Error(e.message)
        console.error('[WebCodecsPlayer] AudioDecoder error:', e.message)
      },
    })

    const config: AudioDecoderConfig = {
      codec: entry.codec.codec,
      sampleRate: entry.codec.sampleRate,
      numberOfChannels: entry.codec.numberOfChannels,
      ...(entry.codec.extra ?? {}),
    }
    decoder.configure(config)
    if (decoderError) throw decoderError
    entry.decoder = decoder
    return decoder
  }

  // ── Byte-range fetch + decode (compressed audio) ─────────────────────────

  private async decodeBytesRange(
    entry: SourceEntry,
    decoder: AudioDecoder,
    startByte: number,
    endByte: number,
    sourceStart: number,
    signal: AbortSignal,
  ): Promise<void> {
    let offset = startByte
    let frameTime = sourceStart

    while (offset < endByte && !signal.aborted) {
      while (entry.bufferedAhead > TARGET_BUFFER_SECS && !signal.aborted) {
        await new Promise<void>((r) => setTimeout(r, 50))
        entry.bufferedAhead = Math.max(0, entry.bufferedAhead - 0.05)
      }
      if (signal.aborted) break

      const chunkEnd = Math.min(offset + FETCH_CHUNK, endByte)
      let resp: Response
      try {
        resp = await fetch(entry.url, {
          headers: { Range: `bytes=${offset}-${chunkEnd - 1}` },
          signal,
        })
      } catch {
        break
      }

      if (!resp.ok || signal.aborted) break
      const bytes = new Uint8Array(await resp.arrayBuffer())
      if (bytes.byteLength === 0) break

      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round(frameTime * 1_000_000),
          data: bytes,
        }),
      )

      frameTime += bytes.byteLength / (entry.codec.sampleRate * entry.codec.numberOfChannels * 2)
      offset += bytes.byteLength
      if (bytes.byteLength < chunkEnd - offset + bytes.byteLength) break
    }
  }

  // ── WAV raw PCM decoder ───────────────────────────────────────────────────

  private async decodePcmBytesRange(
    entry: SourceEntry,
    startByte: number,
    endByte: number,
    sourceStart: number,
    signal: AbortSignal,
  ): Promise<void> {
    const info = entry.wavInfo!
    let offset = startByte
    let frameTime = sourceStart

    while (offset < endByte && !signal.aborted) {
      while (entry.bufferedAhead > TARGET_BUFFER_SECS && !signal.aborted) {
        await new Promise<void>((r) => setTimeout(r, 50))
        entry.bufferedAhead = Math.max(0, entry.bufferedAhead - 0.05)
      }
      if (signal.aborted) break

      const chunkEnd = Math.min(offset + FETCH_CHUNK, endByte)
      const bytesRequested = chunkEnd - offset
      let resp: Response
      try {
        resp = await fetch(entry.url, {
          headers: { Range: `bytes=${offset}-${chunkEnd - 1}` },
          signal,
        })
      } catch {
        break
      }

      if (!resp.ok || signal.aborted) break
      const bytes = new Uint8Array(await resp.arrayBuffer())
      if (bytes.byteLength === 0) break

      const frameCount = Math.floor(bytes.byteLength / info.bytesPerFrame)
      if (frameCount > 0) {
        const channels: Float32Array[] = Array.from(
          { length: info.channels },
          () => new Float32Array(frameCount),
        )
        const view = new DataView(bytes.buffer, bytes.byteOffset)
        const bytesPerSample = info.bitDepth / 8

        for (let f = 0; f < frameCount; f++) {
          for (let c = 0; c < info.channels; c++) {
            const pos = (f * info.channels + c) * bytesPerSample
            let sample: number
            if (info.isFloat) {
              sample = view.getFloat32(pos, true)
            } else if (info.bitDepth === 16) {
              sample = view.getInt16(pos, true) / 32768
            } else if (info.bitDepth === 24) {
              const lo = view.getUint16(pos, true)
              const hi = view.getInt8(pos + 2)
              sample = ((hi << 16) | lo) / 8388608
            } else if (info.bitDepth === 32) {
              sample = view.getInt32(pos, true) / 2147483648
            } else {
              sample = 0
            }
            channels[c][f] = sample
          }
        }

        entry.bufferedAhead += frameCount / info.sampleRate
        sendPcmChunk(entry.worklet!.port, { channels, timestamp: frameTime })
        frameTime += frameCount / info.sampleRate
      }

      offset += bytes.byteLength
      if (bytes.byteLength < bytesRequested) break
    }
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  private emitTimeUpdate(t: number): void {
    this.timeUpdateCbs.forEach((cb) => cb(t))
  }
  private emitPlayState(p: boolean): void {
    this.playStateCbs.forEach((cb) => cb(p))
  }
}
