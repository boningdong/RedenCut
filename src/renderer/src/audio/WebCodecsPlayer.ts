// ─────────────────────────────────────────────────────────────────────────────
// WebCodecsPlayer — Phase 2 IAudioPlayer
//
// Frame-accurate non-linear playback via WebCodecs AudioDecoder + AudioWorklet.
//
// Key advantage over SimpleAudioPlayer:
//   True skip at cut boundaries — the decode loop physically skips to the
//   byte offset of the next clip instead of playing through silenced audio.
//
// Data flow:
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
//
// Clock: We track currentTime via AudioContext.currentTime delta since play().
// This is jitter-free and decoupled from the decode pipeline latency.
//
// Seek:
//   1. pause decode loop + flush worklet
//   2. reposition _currentTime
//   3. restart decode loop from the nearest frame boundary (FrameIndex.seek)
//
// Supported codecs: MP3, AAC/M4A, Opus, FLAC (via AudioDecoder.isConfigSupported)
// Falls back gracefully: if a codec isn't supported, loadSourceFile rejects,
// and App.tsx should fall back to SimpleAudioPlayer.
// ─────────────────────────────────────────────────────────────────────────────

import type { IAudioPlayer } from '@shared/player.types'
import type { Track, Clip } from '@shared/project.types'
import { buildFrameIndex, type FrameIndex } from './FrameIndex'
import { WORKLET_CODE, sendPcmChunk } from './AudioPlayerWorklet'

// ── WAV PCM descriptor ────────────────────────────────────────────────────────

interface WavInfo {
  channels:      number
  sampleRate:    number
  bitDepth:      number   // 16, 24, or 32
  isFloat:       boolean  // true when AudioFormat == 3 (32-bit IEEE float)
  dataOffset:    number   // byte position of the first PCM sample in the file
  bytesPerFrame: number   // channels × (bitDepth / 8) — one sample per channel
  totalBytes:    number   // total file size (for exact duration)
}

/**
 * Fetch the first 256 bytes of a WAV file and parse the fmt/data chunk headers.
 * 256 bytes is enough to cover a standard 44-byte PCM header plus any LIST/INFO
 * metadata that some encoders insert before the data chunk.
 */
async function parseWavInfo(url: string): Promise<WavInfo> {
  const resp = await fetch(url, { headers: { Range: 'bytes=0-255' } })
  const buf  = new Uint8Array(await resp.arrayBuffer())
  const view = new DataView(buf.buffer, buf.byteOffset)

  // Get total file size from the Content-Range response header
  const contentRange = resp.headers.get('content-range') ?? ''
  const totalMatch   = contentRange.match(/\/(\d+)$/)
  const totalBytes   = totalMatch ? parseInt(totalMatch[1]) : 0

  const audioFormat = view.getUint16(20, true)  // 1 = PCM, 3 = IEEE 754 float
  const channels    = view.getUint16(22, true)
  const sampleRate  = view.getUint32(24, true)
  const bitDepth    = view.getUint16(34, true)

  // Walk sub-chunks after the RIFF/WAVE/fmt headers to find "data".
  // Standard layout: RIFF(4) + size(4) + WAVE(4) + fmt (8+16) = 44 bytes.
  // Non-standard: extra chunks (LIST, INFO, JUNK) may come first.
  let dataOffset = 12  // start just past "RIFF" + fileSize + "WAVE"
  while (dataOffset + 8 <= buf.byteLength) {
    const id = String.fromCharCode(
      buf[dataOffset], buf[dataOffset + 1], buf[dataOffset + 2], buf[dataOffset + 3],
    )
    const chunkSize = view.getUint32(dataOffset + 4, true)
    dataOffset += 8
    if (id === 'data') break
    dataOffset += chunkSize + (chunkSize & 1)  // chunks are word-aligned
  }

  return {
    channels,
    sampleRate,
    bitDepth,
    isFloat:       audioFormat === 3,
    dataOffset,
    bytesPerFrame: channels * (bitDepth / 8),
    totalBytes,
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Bytes per fetch chunk for compressed audio. ~16 frames of 128 kbps MP3. */
const FETCH_CHUNK = 32_768

/**
 * How many decoded seconds to buffer ahead of the playhead.
 * We pause the decode loop while the buffer is this full and resume
 * when it drops below half.  Larger = more memory, fewer underruns.
 */
const TARGET_BUFFER_SECS = 2.0
const RESUME_BUFFER_SECS = 1.0

// ── Codec config helpers ──────────────────────────────────────────────────────

interface CodecConfig {
  codec:            string
  sampleRate:       number
  numberOfChannels: number
  /** Optional extra codec-specific fields (e.g. aac = { aac: { format: 'adts' } }) */
  extra?: Record<string, unknown>
}

function guessCodecConfig(url: string, sampleRate: number): CodecConfig {
  const lower = url.toLowerCase()
  if (lower.includes('.m4a') || lower.includes('.aac')) {
    return { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2,
             extra: { aac: { format: 'adts' } } }
  }
  if (lower.includes('.opus')) return { codec: 'opus', sampleRate, numberOfChannels: 2 }
  if (lower.includes('.flac')) return { codec: 'flac', sampleRate, numberOfChannels: 2 }
  // Default: MP3
  return { codec: 'mp3', sampleRate, numberOfChannels: 2 }
}

// ── Source registry entry ─────────────────────────────────────────────────────

interface SourceEntry {
  url:       string
  index:     FrameIndex
  codec:     CodecConfig
  duration:  number
  /** Defined for WAV sources — bypasses AudioDecoder in favour of raw PCM decode. */
  wavInfo?:  WavInfo
}

// ── WebCodecsPlayer ───────────────────────────────────────────────────────────

export class WebCodecsPlayer implements IAudioPlayer {
  // ── Web Audio graph ────────────────────────────────────────────────────────
  private ctx:     AudioContext | null = null
  private worklet: AudioWorkletNode | null = null

  // ── Decoder (one shared decoder, reconfigured on source change) ────────────
  private decoder: AudioDecoder | null = null

  // ── Source registry ────────────────────────────────────────────────────────
  private sources         = new Map<string, SourceEntry>()
  private primarySourceId: string | null = null

  // ── Track model ────────────────────────────────────────────────────────────
  private tracks: Track[] = []

  // ── Playback state ─────────────────────────────────────────────────────────
  private _isPlaying    = false
  private _currentTime  = 0
  private _duration     = 0

  // Clock: AudioContext time at the moment play() was called
  private _ctxTimeAtPlay: number | null = null
  // _currentTime value at the moment play() was called
  private _posAtPlay: number = 0

  // ── Decode pipeline ────────────────────────────────────────────────────────
  private _decodeCtrl:   AbortController | null = null
  // Approximate decoded-ahead duration (maintained by decode loop)
  private _bufferedAhead = 0

  // ── rAF handle ────────────────────────────────────────────────────────────
  private _rafId: number | null = null

  // ── Callbacks ──────────────────────────────────────────────────────────────
  private timeUpdateCbs     = new Set<(t: number) => void>()
  private playStateCbs      = new Set<(p: boolean) => void>()
  private durationChangeCbs = new Set<(d: number) => void>()
  private endedCbs          = new Set<() => void>()

  // ── AudioContext / Worklet setup ──────────────────────────────────────────

  private async ensureCtx(): Promise<AudioContext> {
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx
    this.ctx = new AudioContext()
    console.log('[WebCodecsPlayer] AudioContext created, sampleRate:', this.ctx.sampleRate)
    await this.loadWorklet()
    return this.ctx
  }

  private async loadWorklet(): Promise<void> {
    if (!this.ctx) return
    const blob    = new Blob([WORKLET_CODE], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    try {
      await this.ctx.audioWorklet.addModule(blobUrl)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
    this.worklet = new AudioWorkletNode(this.ctx, 'podcut-player', {
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    this.worklet.connect(this.ctx.destination)
    console.log('[WebCodecsPlayer] AudioWorklet ready')
  }

  // ── IAudioPlayer — loadSourceFile ─────────────────────────────────────────

  async loadSourceFile(id: string, filePath: string): Promise<void> {
    if (this.sources.has(id)) {
      console.log(`[WebCodecsPlayer] source already loaded id=${id}`)
      return
    }

    console.log(`[WebCodecsPlayer] loadSourceFile id=${id} — probing + building FrameIndex`)
    const url = `podcut://localhost/${encodeURIComponent(filePath)}`

    // Build frame index (fetches a chunk of the file to scan frame headers)
    const index = await buildFrameIndex(url)

    // ── WAV: raw PCM path (bypasses AudioDecoder) ─────────────────────────
    if (url.toLowerCase().includes('.wav')) {
      const wavInfo  = await parseWavInfo(url)
      await this.ensureCtx()  // still need AudioContext for the worklet

      // Precise duration from file size and format, not the approximated FrameIndex
      const pcmBytes = wavInfo.totalBytes - wavInfo.dataOffset
      const duration = pcmBytes / (wavInfo.sampleRate * wavInfo.bytesPerFrame)

      const codec: CodecConfig = {
        codec:            'pcm',
        sampleRate:       wavInfo.sampleRate,
        numberOfChannels: wavInfo.channels,
      }

      this.sources.set(id, { url, index, codec, duration, wavInfo })
      if (!this.primarySourceId) {
        this.primarySourceId = id
        this._duration = duration
        this.durationChangeCbs.forEach((cb) => cb(duration))
      }
      console.log(
        `[WebCodecsPlayer] loaded WAV id=${id} — ${wavInfo.channels}ch ${wavInfo.sampleRate}Hz ` +
        `${wavInfo.bitDepth}-bit${wavInfo.isFloat ? ' float' : ''} duration=${duration.toFixed(2)}s`,
      )
      return
    }

    // ── Compressed: AudioDecoder path ─────────────────────────────────────
    // Determine sampleRate for codec config — probe from FrameIndex if available,
    // otherwise use the most common podcast rate (44100)
    const sampleRate = index.frames.length > 1
      ? Math.round(1 / index.frames[0].duration * 1152)  // MP3: 1152 samples/frame
      : 44100

    const ctx   = await this.ensureCtx()
    const codec = guessCodecConfig(url, ctx.sampleRate)

    // Validate that the codec is supported before accepting the source
    const config: AudioDecoderConfig = {
      codec:            codec.codec,
      sampleRate:       codec.sampleRate,
      numberOfChannels: codec.numberOfChannels,
      ...(codec.extra ?? {}),
    }
    const support = await AudioDecoder.isConfigSupported(config)
    if (!support.supported) {
      throw new Error(`[WebCodecsPlayer] codec '${codec.codec}' not supported — use SimpleAudioPlayer`)
    }

    // Estimate duration from the last frame
    const lastFrame = index.frames[index.frames.length - 1]
    const duration  = lastFrame ? lastFrame.time + lastFrame.duration : 0

    this.sources.set(id, { url, index, codec, duration })
    if (!this.primarySourceId) {
      this.primarySourceId = id
      this._duration = duration
      this.durationChangeCbs.forEach((cb) => cb(duration))
    }

    console.log(`[WebCodecsPlayer] loaded id=${id} codec=${codec.codec} duration=${duration.toFixed(2)}s`)
    void sampleRate   // suppress unused-var warning — we derive sampleRate from ctx instead
  }

  // ── IAudioPlayer — setTracks ──────────────────────────────────────────────

  setTracks(tracks: Track[]): void {
    this.tracks = tracks
    console.log(`[WebCodecsPlayer] setTracks — ${tracks.length} tracks`)
    // If currently playing, restart the decode loop from the current position
    // so it picks up the new mute map immediately.
    if (this._isPlaying) {
      this.restartDecodeLoop(this._currentTime)
    }
  }

  // ── IAudioPlayer — playback control ──────────────────────────────────────

  async play(): Promise<void> {
    if (this._isPlaying) return
    const ctx = await this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    this._isPlaying      = true
    this._ctxTimeAtPlay  = ctx.currentTime
    this._posAtPlay      = this._currentTime

    this.emitPlayState(true)
    this.startRaf()
    this.startDecodeLoop(this._currentTime)
    console.log(`[WebCodecsPlayer] play() t=${this._currentTime.toFixed(2)}s`)
  }

  pause(): void {
    if (!this._isPlaying) return
    console.log(`[WebCodecsPlayer] pause() t=${this._currentTime.toFixed(2)}s`)
    this.stopDecodeLoop()
    this.stopRaf()
    this._isPlaying = false
    this.emitPlayState(false)
  }

  async playPause(): Promise<void> {
    if (this._isPlaying) this.pause()
    else await this.play()
  }

  seekTo(outputTime: number): void {
    const clamped = Math.max(0, Math.min(outputTime, this._duration))
    console.log(`[WebCodecsPlayer] seekTo ${clamped.toFixed(2)}s`)

    const wasPlaying = this._isPlaying
    if (wasPlaying) this.pause()

    this._currentTime  = clamped
    this._bufferedAhead = 0
    this.worklet?.port.postMessage({ type: 'flush' })
    this.emitTimeUpdate(clamped)

    if (wasPlaying) this.play().catch(console.error)
  }

  // ── IAudioPlayer — state queries ──────────────────────────────────────────

  getCurrentTime(): number { return this._currentTime }
  getDuration():    number { return this._duration }
  isPlaying():      boolean { return this._isPlaying }

  // ── IAudioPlayer — event subscriptions ───────────────────────────────────

  onTimeUpdate(cb: (t: number) => void):    () => void {
    this.timeUpdateCbs.add(cb)
    return () => this.timeUpdateCbs.delete(cb)
  }
  onPlayStateChange(cb: (p: boolean) => void): () => void {
    this.playStateCbs.add(cb)
    return () => this.playStateCbs.delete(cb)
  }
  onDurationChange(cb: (d: number) => void):  () => void {
    this.durationChangeCbs.add(cb)
    return () => this.durationChangeCbs.delete(cb)
  }
  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb)
    return () => this.endedCbs.delete(cb)
  }

  // ── IAudioPlayer — lifecycle ──────────────────────────────────────────────

  destroy(): void {
    console.log('[WebCodecsPlayer] destroy()')
    this.pause()
    this.stopDecodeLoop()
    this.decoder?.close()
    this.decoder = null
    this.worklet?.disconnect()
    this.worklet = null
    this.sources.clear()
    this.primarySourceId = null
    this.tracks = []
    this.timeUpdateCbs.clear()
    this.playStateCbs.clear()
    this.durationChangeCbs.clear()
    this.endedCbs.clear()
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {/* ignore */})
      this.ctx = null
    }
  }

  // ── rAF loop — clock ─────────────────────────────────────────────────────
  //
  // Uses AudioContext.currentTime as the clock source — it advances at the
  // hardware sample clock rate, giving jitter-free position updates.

  private startRaf(): void {
    if (this._rafId !== null) return

    const tick = () => {
      if (!this._isPlaying || !this.ctx || this._ctxTimeAtPlay === null) return

      this._currentTime = this._posAtPlay + (this.ctx.currentTime - this._ctxTimeAtPlay)

      if (this._currentTime >= this._duration) {
        this._currentTime = this._duration
        this.emitTimeUpdate(this._currentTime)
        this._isPlaying = false
        this.stopDecodeLoop()
        this.stopRaf()
        this.emitPlayState(false)
        this.endedCbs.forEach((cb) => cb())
        return
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

  // ── Decode loop ───────────────────────────────────────────────────────────

  private stopDecodeLoop(): void {
    this._decodeCtrl?.abort()
    this._decodeCtrl = null
  }

  private startDecodeLoop(fromTime: number): void {
    this.stopDecodeLoop()
    const ctrl = new AbortController()
    this._decodeCtrl = ctrl
    this.runDecodeLoop(fromTime, ctrl.signal).catch((err) => {
      if ((err as Error).name !== 'AbortError') {
        console.error('[WebCodecsPlayer] decode loop error:', err)
      }
    })
  }

  private restartDecodeLoop(fromTime: number): void {
    if (!this._isPlaying) return
    this.worklet?.port.postMessage({ type: 'flush' })
    this._bufferedAhead = 0
    this.startDecodeLoop(fromTime)
  }

  /**
   * The core loop. Iterates the clip list in output order, skipping muted clips,
   * and decodes each unmuted segment via byte-range fetch + AudioDecoder.
   */
  private async runDecodeLoop(startTime: number, signal: AbortSignal): Promise<void> {
    if (!this.primarySourceId) return
    const entry = this.sources.get(this.primarySourceId)
    if (!entry || !this.worklet) return

    const segments = this.buildSegments(startTime)
    console.log(`[WebCodecsPlayer] decode loop: ${segments.length} segments from ${startTime.toFixed(2)}s`)

    if (entry.wavInfo) {
      // ── WAV: direct PCM path — no AudioDecoder ──────────────────────────
      for (const seg of segments) {
        if (signal.aborted) break
        await this.decodePcmBytesRange(entry, seg.startByte, seg.endByte, seg.sourceStart, signal)
      }
    } else {
      // ── Compressed: AudioDecoder path ───────────────────────────────────
      const dec = await this.openDecoder(entry)
      for (const seg of segments) {
        if (signal.aborted) break
        console.log(`[WebCodecsPlayer] segment [${seg.sourceStart.toFixed(2)}s] bytes ${seg.startByte}–${seg.endByte}`)
        await this.decodeBytesRange(entry, dec, seg.startByte, seg.endByte, seg.sourceStart, signal)
      }
      if (!signal.aborted) await dec.flush()
    }

    if (!signal.aborted) {
      this.worklet.port.postMessage({ type: 'end' })
      console.log('[WebCodecsPlayer] decode loop complete')
    }
  }

  // ── Segment builder ───────────────────────────────────────────────────────

  private buildSegments(startTime: number): Array<{
    startByte:   number
    endByte:     number
    sourceStart: number
    outputStart: number
  }> {
    if (!this.primarySourceId) return []
    const entry = this.sources.get(this.primarySourceId)
    if (!entry) return []

    const anySolo = this.tracks.some((t) => t.solo)
    const segs: Array<{ startByte: number; endByte: number; sourceStart: number; outputStart: number }> = []

    for (const track of this.tracks) {
      if (track.muted) continue
      if (anySolo && !track.solo) continue

      const sorted = [...track.clips].sort((a, b) => a.outputStart - b.outputStart)

      for (const clip of sorted) {
        if (clip.muted) continue
        if (clip.sourceFileId !== this.primarySourceId) continue

        const clipOutputEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
        if (clipOutputEnd <= startTime) continue

        // Where in this clip does playback start?
        const seekSourceTime = Math.max(
          clip.sourceStart,
          clip.sourceStart + (startTime - clip.outputStart),
        )

        const startFrame = entry.index.seek(seekSourceTime)
        const endFrame   = entry.index.seek(clip.sourceEnd)

        segs.push({
          startByte:   startFrame.byteOffset,
          endByte:     endFrame.byteOffset + FETCH_CHUNK,  // slightly past to ensure complete last frame
          sourceStart: startFrame.time,
          outputStart: clip.outputStart + (startFrame.time - clip.sourceStart),
        })
      }
    }

    // If no tracks/clips defined (e.g. before setTracks), decode the full file
    if (segs.length === 0 && this.sources.size > 0) {
      const startFrame = entry.index.seek(startTime)
      segs.push({
        startByte:   startFrame.byteOffset,
        endByte:     Number.MAX_SAFE_INTEGER,
        sourceStart: startFrame.time,
        outputStart: startFrame.time,
      })
    }

    return segs
  }

  // ── AudioDecoder management ───────────────────────────────────────────────

  private async openDecoder(entry: SourceEntry): Promise<AudioDecoder> {
    // Close any old decoder first
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close()
      this.decoder = null
    }

    const workletPort = this.worklet!.port
    let decoderError: Error | null = null

    const decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        const ch  = audioData.numberOfChannels
        const len = audioData.numberOfFrames
        const ts  = audioData.timestamp / 1_000_000  // µs → s

        const channels: Float32Array[] = []
        for (let c = 0; c < ch; c++) {
          const buf = new Float32Array(len)
          audioData.copyTo(buf, { planeIndex: c, format: 'f32-planar' })
          channels.push(buf)
        }
        audioData.close()

        // Track buffered-ahead window (rough — based on frame duration)
        this._bufferedAhead += len / (entry.codec.sampleRate || 44100)

        sendPcmChunk(workletPort, { channels, timestamp: ts })
      },
      error: (e: DOMException) => {
        decoderError = new Error(e.message)
        console.error('[WebCodecsPlayer] AudioDecoder error:', e.message)
      },
    })

    const config: AudioDecoderConfig = {
      codec:            entry.codec.codec,
      sampleRate:       entry.codec.sampleRate,
      numberOfChannels: entry.codec.numberOfChannels,
      ...(entry.codec.extra ?? {}),
    }

    decoder.configure(config)
    if (decoderError) throw decoderError
    this.decoder = decoder
    console.log(`[WebCodecsPlayer] AudioDecoder configured: ${entry.codec.codec} @ ${entry.codec.sampleRate} Hz`)
    return decoder
  }

  // ── Byte-range fetch + decode ─────────────────────────────────────────────

  private async decodeBytesRange(
    entry:       SourceEntry,
    decoder:     AudioDecoder,
    startByte:   number,
    endByte:     number,
    sourceStart: number,
    signal:      AbortSignal,
  ): Promise<void> {
    let offset   = startByte
    let frameTime = sourceStart  // PTS estimate in seconds

    while (offset < endByte && !signal.aborted) {
      // Throttle: if we're sufficiently ahead, wait for the playhead to catch up
      while (
        this._bufferedAhead > TARGET_BUFFER_SECS &&
        !signal.aborted
      ) {
        // Decay bufferedAhead by elapsed real time
        await new Promise<void>((r) => setTimeout(r, 50))
        this._bufferedAhead = Math.max(
          0,
          this._bufferedAhead - 0.05,
        )
      }
      if (signal.aborted) break

      const chunkEnd  = Math.min(offset + FETCH_CHUNK, endByte)
      let   resp: Response

      try {
        resp = await fetch(entry.url, {
          headers: { Range: `bytes=${offset}-${chunkEnd - 1}` },
          signal,
        })
      } catch {
        break   // AbortError or network error — exit gracefully
      }

      if (!resp.ok || signal.aborted) break

      const bytes = new Uint8Array(await resp.arrayBuffer())
      if (bytes.byteLength === 0) break

      // Each fetch chunk is wrapped in a single EncodedAudioChunk.
      // For MP3 the decoder tolerates partial frames at chunk boundaries —
      // it scans for sync words internally.
      // For AAC/ADTS each FETCH_CHUNK should contain complete ADTS frames;
      // our 32 KB chunk size is much larger than a single ADTS frame (~192 bytes).
      decoder.decode(new EncodedAudioChunk({
        type:      'key',
        timestamp: Math.round(frameTime * 1_000_000),  // s → µs
        data:      bytes,
      }))

      frameTime += bytes.byteLength / (entry.codec.sampleRate * entry.codec.numberOfChannels * 2)
      offset    += bytes.byteLength

      // Check for 206 Partial Content end (server returned less than requested)
      if (bytes.byteLength < chunkEnd - offset + bytes.byteLength) {
        break  // reached end of file
      }
    }
  }

  // ── WAV raw PCM decoder ───────────────────────────────────────────────────
  //
  // Fetches byte ranges of interleaved PCM samples, de-interleaves into
  // per-channel Float32Array[], normalises to -1..1, and ships to the worklet.
  // Supports 16-bit int, 24-bit int, 32-bit int, and 32-bit float PCM.

  private async decodePcmBytesRange(
    entry:       SourceEntry,
    startByte:   number,
    endByte:     number,
    sourceStart: number,
    signal:      AbortSignal,
  ): Promise<void> {
    const info = entry.wavInfo!
    let offset    = startByte
    let frameTime = sourceStart

    while (offset < endByte && !signal.aborted) {
      // Throttle: pause when the worklet queue is full enough
      while (this._bufferedAhead > TARGET_BUFFER_SECS && !signal.aborted) {
        await new Promise<void>((r) => setTimeout(r, 50))
        this._bufferedAhead = Math.max(0, this._bufferedAhead - 0.05)
      }
      if (signal.aborted) break

      const chunkEnd      = Math.min(offset + FETCH_CHUNK, endByte)
      const bytesRequested = chunkEnd - offset
      let resp: Response
      try {
        resp = await fetch(entry.url, {
          headers: { Range: `bytes=${offset}-${chunkEnd - 1}` },
          signal,
        })
      } catch { break }

      if (!resp.ok || signal.aborted) break

      const bytes = new Uint8Array(await resp.arrayBuffer())
      if (bytes.byteLength === 0) break

      // Truncate to a whole number of frames so we never split a sample
      const frameCount = Math.floor(bytes.byteLength / info.bytesPerFrame)
      if (frameCount > 0) {
        const channels: Float32Array[] = Array.from(
          { length: info.channels },
          () => new Float32Array(frameCount),
        )

        const view            = new DataView(bytes.buffer, bytes.byteOffset)
        const bytesPerSample  = info.bitDepth / 8

        for (let f = 0; f < frameCount; f++) {
          for (let c = 0; c < info.channels; c++) {
            const pos = (f * info.channels + c) * bytesPerSample
            let sample: number

            if (info.isFloat) {
              sample = view.getFloat32(pos, true)
            } else if (info.bitDepth === 16) {
              sample = view.getInt16(pos, true) / 32768
            } else if (info.bitDepth === 24) {
              // 24-bit: 2 unsigned bytes (lo) + 1 signed byte (hi)
              const lo = view.getUint16(pos,     true)
              const hi = view.getInt8  (pos + 2)
              sample   = ((hi << 16) | lo) / 8388608
            } else if (info.bitDepth === 32) {
              sample = view.getInt32(pos, true) / 2147483648
            } else {
              sample = 0
            }

            channels[c][f] = sample
          }
        }

        this._bufferedAhead += frameCount / info.sampleRate
        sendPcmChunk(this.worklet!.port, { channels, timestamp: frameTime })
        frameTime += frameCount / info.sampleRate
      }

      offset += bytes.byteLength
      if (bytes.byteLength < bytesRequested) break  // server returned less → EOF
    }
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  private emitTimeUpdate(t: number): void { this.timeUpdateCbs.forEach((cb) => cb(t)) }
  private emitPlayState(p: boolean): void { this.playStateCbs.forEach((cb) => cb(p)) }
}
