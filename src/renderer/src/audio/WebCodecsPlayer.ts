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
 *
 * Uses a streaming read so that large WAV files (700 MB+) are never fully
 * buffered in the renderer — even if the server ignores the Range header and
 * returns the entire file body, we consume only the first 256 bytes and
 * cancel the rest of the stream.
 */
async function parseWavInfo(url: string): Promise<WavInfo> {
  const resp = await fetch(url, { headers: { Range: 'bytes=0-255' } })

  // ── Total file size ───────────────────────────────────────────────────────
  // 206 Partial Content: read from Content-Range: bytes 0-255/<total>
  // 200 OK (Range not honoured): read from Content-Length
  let totalBytes = 0
  const contentRange = resp.headers.get('content-range') ?? ''
  const crMatch      = contentRange.match(/\/(\d+)$/)
  if (crMatch) {
    totalBytes = parseInt(crMatch[1])
  } else {
    totalBytes = parseInt(resp.headers.get('content-length') ?? '0')
  }

  // ── Stream-read at most 256 bytes ─────────────────────────────────────────
  // IMPORTANT: do NOT call resp.arrayBuffer() — if Range is not honoured the
  // body is the full WAV (can be hundreds of MB) and would OOM the renderer.
  const reader  = resp.body!.getReader()
  const scratch = new Uint8Array(256)
  let bytesRead = 0
  while (bytesRead < 256) {
    const { done, value } = await reader.read()
    if (done || !value) break
    const toCopy = Math.min(value.length, 256 - bytesRead)
    scratch.set(value.subarray(0, toCopy), bytesRead)
    bytesRead += toCopy
  }
  reader.cancel().catch(() => { /* ignore stream-cancel errors */ })

  if (bytesRead < 36) {
    throw new Error(`[WebCodecsPlayer] WAV header too short: only ${bytesRead} bytes readable`)
  }

  const buf  = scratch.subarray(0, bytesRead)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // ── RIFF chunk-size fallback ──────────────────────────────────────────────
  // Electron's net.fetch for file:// URLs often omits Content-Length and
  // Content-Range headers, leaving totalBytes = 0.  The RIFF header at bytes
  // 4-7 contains (fileSize - 8) as a uint32 LE — always reliable.
  if (totalBytes === 0 && bytesRead >= 8) {
    totalBytes = view.getUint32(4, true) + 8
    console.log(`[WebCodecsPlayer] WAV totalBytes from RIFF header: ${totalBytes}`)
  }

  // ── Parse fmt fields from fixed offsets ───────────────────────────────────
  // Valid for standard WAV where "fmt " is the first sub-chunk (offset 12).
  // DAW exports that insert a JUNK chunk first will have wrong values here,
  // but the vast majority of podcast audio uses standard layout.
  const audioFormat = view.getUint16(20, true)  // 1 = PCM, 3 = IEEE 754 float
  const channels    = view.getUint16(22, true)
  const sampleRate  = view.getUint32(24, true)
  const bitDepth    = view.getUint16(34, true)

  // ── Walk sub-chunks to find "data" offset ─────────────────────────────────
  // Standard layout: RIFF(4) + size(4) + WAVE(4) + fmt (8+16) = 44 bytes.
  // Non-standard: extra chunks (LIST, INFO, JUNK) may come before "data".
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

  /**
   * Ensure an AudioContext + worklet exist.  Pass the file's native sample rate
   * so that the context runs at the same rate — if they mismatch, every sample
   * is played at the wrong speed and the pitch shifts audibly.
   */
  private async ensureCtx(sampleRate?: number): Promise<AudioContext> {
    if (this.ctx && this.ctx.state !== 'closed') {
      // Recreate if the caller wants a different sample rate
      if (sampleRate && this.ctx.sampleRate !== sampleRate) {
        console.log(`[WebCodecsPlayer] Recreating AudioContext: ${this.ctx.sampleRate} → ${sampleRate}`)
        this.worklet?.disconnect()
        this.worklet = null
        await this.ctx.close()
        this.ctx = null
      } else {
        return this.ctx
      }
    }
    this.ctx = new AudioContext(sampleRate ? { sampleRate } : undefined)
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

    // When the worklet drains its first real audio block it sends 'started'.
    // We use that moment to zero the AudioContext clock so the displayed
    // playhead position exactly matches when audio physically begins.
    this.worklet.port.onmessage = ({ data }) => {
      if (data.type === 'started' && this._isPlaying && this.ctx) {
        this._ctxTimeAtPlay = this.ctx.currentTime
        console.log('[WebCodecsPlayer] audio started — clock zeroed')
      }
    }

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
      // Step A: parse WAV header (streaming — safe for large files)
      let wavInfo: WavInfo
      try {
        wavInfo = await parseWavInfo(url)
        console.log(
          `[WebCodecsPlayer] WAV header — ${wavInfo.channels}ch ${wavInfo.sampleRate}Hz ` +
          `${wavInfo.bitDepth}-bit${wavInfo.isFloat ? ' float' : ''} ` +
          `dataOffset=${wavInfo.dataOffset} totalBytes=${wavInfo.totalBytes}`,
        )
      } catch (err) {
        console.error('[WebCodecsPlayer] parseWavInfo failed:', err)
        throw err
      }

      // Step B: set up AudioContext + worklet at the file's native sample rate
      try {
        await this.ensureCtx(wavInfo.sampleRate)
      } catch (err) {
        console.error('[WebCodecsPlayer] ensureCtx failed:', err)
        throw err
      }

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
      // Start pre-buffering immediately so the queue is warm before play()
      if (!this._decodeCtrl) this.startDecodeLoop(this._currentTime)
      return
    }

    // ── Compressed: AudioDecoder path ─────────────────────────────────────
    // Determine sampleRate for codec config — probe from FrameIndex if available,
    // otherwise use the most common podcast rate (44100)
    const sampleRate = index.frames.length > 1
      ? Math.round(1 / index.frames[0].duration * 1152)  // MP3: 1152 samples/frame
      : 44100

    // Create the AudioContext at the file's actual sample rate so decoded PCM
    // plays at the correct pitch (no resampling in the worklet).
    await this.ensureCtx(sampleRate)
    const codec = guessCodecConfig(url, sampleRate)

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

    console.log(`[WebCodecsPlayer] loaded id=${id} codec=${codec.codec} sampleRate=${sampleRate} duration=${duration.toFixed(2)}s`)
    // Start pre-buffering immediately so the queue is warm before play()
    if (!this._decodeCtrl) this.startDecodeLoop(this._currentTime)
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

    this._isPlaying     = true
    // _ctxTimeAtPlay is intentionally left as-is here.  It will be set to
    // ctx.currentTime by the worklet's 'started' callback — the moment the
    // first real audio block drains.  Until then, the rAF loop holds the
    // playhead at _posAtPlay (no visible jump during the pre-buffer gap).
    this._ctxTimeAtPlay = null
    this._posAtPlay     = this._currentTime

    // Open the worklet gate: it starts draining the pre-buffered queue.
    this.worklet?.port.postMessage({ type: 'play' })

    this.emitPlayState(true)
    this.startRaf()
    // The decode loop may already be running from pre-buffering; only start
    // it if it was stopped (e.g. after destroy/seek).
    if (!this._decodeCtrl) {
      this.startDecodeLoop(this._currentTime)
    }
    console.log(`[WebCodecsPlayer] play() t=${this._currentTime.toFixed(2)}s`)
  }

  pause(): void {
    if (!this._isPlaying) return
    console.log(`[WebCodecsPlayer] pause() t=${this._currentTime.toFixed(2)}s`)
    // Close the worklet gate — it will keep buffering incoming PCM but output
    // silence, so the queue stays warm for the next play() call.
    this.worklet?.port.postMessage({ type: 'pause' })
    this.stopRaf()
    this._isPlaying     = false
    this._ctxTimeAtPlay = null
    this.emitPlayState(false)
    // Keep _decodeCtrl running: the decode loop continues to fill the pre-buffer
    // so there is zero latency when the user hits play again.
  }

  async playPause(): Promise<void> {
    if (this._isPlaying) this.pause()
    else await this.play()
  }

  seekTo(outputTime: number): void {
    const clamped = Math.max(0, Math.min(outputTime, this._duration))
    console.log(`[WebCodecsPlayer] seekTo ${clamped.toFixed(2)}s`)

    const wasPlaying = this._isPlaying
    if (wasPlaying) {
      this.worklet?.port.postMessage({ type: 'pause' })
      this.stopRaf()
      this._isPlaying     = false
      this._ctxTimeAtPlay = null
      this.emitPlayState(false)
    }

    this._currentTime   = clamped
    this._posAtPlay     = clamped
    this._ctxTimeAtPlay = null
    this._bufferedAhead = 0
    // flush stale audio and reset the 'started' arm inside the worklet
    this.worklet?.port.postMessage({ type: 'flush' })
    this.emitTimeUpdate(clamped)

    // Always restart the decode loop from the new position so the worklet
    // queue is warm before the user hits play (zero-latency pre-buffer).
    this.startDecodeLoop(clamped)

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
      if (!this._isPlaying || !this.ctx) return

      if (this._ctxTimeAtPlay !== null) {
        // Clock is running — advance playhead using the AudioContext hardware clock.
        this._currentTime = this._posAtPlay + (this.ctx.currentTime - this._ctxTimeAtPlay)

        if (this._currentTime >= this._duration) {
          this._currentTime = this._duration
          this.emitTimeUpdate(this._currentTime)
          this._isPlaying = false
          this.worklet?.port.postMessage({ type: 'pause' })
          this.stopDecodeLoop()
          this.stopRaf()
          this._ctxTimeAtPlay = null
          this.emitPlayState(false)
          this.endedCbs.forEach((cb) => cb())
          return
        }
      }
      // If _ctxTimeAtPlay is still null (worklet hasn't drained audio yet),
      // emit the current position unchanged so the playhead stays still.

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
    this.worklet?.port.postMessage({ type: 'flush' })
    this._bufferedAhead = 0
    this.startDecodeLoop(fromTime)
  }

  /**
   * The core loop.  Iterates the clip list in output order and decodes each
   * segment via byte-range fetch + AudioDecoder.  Muted segments get silence
   * pushed into the worklet queue so the cursor advances at real speed.
   */
  private async runDecodeLoop(startTime: number, signal: AbortSignal): Promise<void> {
    if (!this.primarySourceId) return
    const entry = this.sources.get(this.primarySourceId)
    if (!entry || !this.worklet) return

    const segments = this.buildSegments(startTime)
    console.log(`[WebCodecsPlayer] decode loop: ${segments.length} segments from ${startTime.toFixed(2)}s`)

    const sampleRate  = entry.wavInfo?.sampleRate  ?? entry.codec.sampleRate
    const numChannels = entry.wavInfo?.channels     ?? entry.codec.numberOfChannels

    if (entry.wavInfo) {
      // ── WAV: direct PCM path — no AudioDecoder ──────────────────────────
      for (const seg of segments) {
        if (signal.aborted) break
        if (seg.muted) {
          await this.feedSilence(seg.durationSecs, sampleRate, numChannels, signal)
          continue
        }
        await this.decodePcmBytesRange(entry, seg.startByte, seg.endByte, seg.sourceStart, signal)
      }
    } else {
      // ── Compressed: AudioDecoder path ───────────────────────────────────
      const dec = await this.openDecoder(entry)
      for (const seg of segments) {
        if (signal.aborted) break
        if (seg.muted) {
          await this.feedSilence(seg.durationSecs, sampleRate, numChannels, signal)
          continue
        }
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

  // ── Silence feeder for muted segments ──────────────────────────────────
  //
  // Pushes zero-filled PCM chunks into the worklet queue so the FIFO stays
  // time-aligned with the clock.  Respects the same throttle as real decode
  // so we don't flood the queue.

  private async feedSilence(
    durationSecs: number,
    sampleRate:   number,
    numChannels:  number,
    signal:       AbortSignal,
  ): Promise<void> {
    const CHUNK_FRAMES = 4096
    let remaining = durationSecs

    while (remaining > 0 && !signal.aborted) {
      // Respect the buffer-ahead throttle
      while (this._bufferedAhead > TARGET_BUFFER_SECS && !signal.aborted) {
        await new Promise<void>((r) => setTimeout(r, 50))
        this._bufferedAhead = Math.max(0, this._bufferedAhead - 0.05)
      }
      if (signal.aborted) break

      const chunkDur = Math.min(CHUNK_FRAMES / sampleRate, remaining)
      const frames   = Math.ceil(chunkDur * sampleRate)
      const channels = Array.from({ length: numChannels }, () => new Float32Array(frames))
      sendPcmChunk(this.worklet!.port, { channels, timestamp: 0 })
      this._bufferedAhead += chunkDur
      remaining           -= chunkDur
    }
  }

  // ── Segment builder ───────────────────────────────────────────────────────
  //
  // Builds an ordered list of source-time segments that the decode loop must
  // process.  Muted clips are INCLUDED (with muted=true) so the worklet queue
  // stays time-aligned and the cursor advances through them at real speed.
  // The decode loop sends silence for muted segments instead of fetching audio.

  private buildSegments(startTime: number): Array<{
    startByte:    number
    endByte:      number
    sourceStart:  number
    outputStart:  number
    muted:        boolean
    durationSecs: number
  }> {
    if (!this.primarySourceId) return []
    const entry = this.sources.get(this.primarySourceId)
    if (!entry) return []

    type Seg = { startByte: number; endByte: number; sourceStart: number; outputStart: number; muted: boolean; durationSecs: number }
    const anySolo = this.tracks.some((t) => t.solo)
    const segs: Seg[] = []

    for (const track of this.tracks) {
      if (track.muted) continue
      if (anySolo && !track.solo) continue

      const sorted = [...track.clips].sort((a, b) => a.outputStart - b.outputStart)

      for (const clip of sorted) {
        if (clip.sourceFileId !== this.primarySourceId) continue

        const clipOutputEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
        if (clipOutputEnd <= startTime) continue

        // Where in this clip does playback start?
        const seekSourceTime = Math.max(
          clip.sourceStart,
          clip.sourceStart + (startTime - clip.outputStart),
        )

        if (clip.muted) {
          // Muted clip: include it so silence fills the worklet queue for this
          // time span — keeps the cursor moving at real speed.
          const segDuration = clip.sourceEnd - seekSourceTime
          segs.push({
            startByte:    0,
            endByte:      0,
            sourceStart:  seekSourceTime,
            outputStart:  clip.outputStart + (seekSourceTime - clip.sourceStart),
            muted:        true,
            durationSecs: segDuration,
          })
          continue
        }

        const startFrame = entry.index.seek(seekSourceTime)
        const endFrame   = entry.index.seek(clip.sourceEnd)

        segs.push({
          startByte:    startFrame.byteOffset,
          endByte:      endFrame.byteOffset + FETCH_CHUNK,  // slightly past to ensure complete last frame
          sourceStart:  startFrame.time,
          outputStart:  clip.outputStart + (startFrame.time - clip.sourceStart),
          muted:        false,
          durationSecs: clip.sourceEnd - startFrame.time,
        })
      }
    }

    // If no tracks/clips defined (e.g. before setTracks), decode the full file
    if (segs.length === 0 && this.sources.size > 0) {
      const startFrame = entry.index.seek(startTime)
      segs.push({
        startByte:    startFrame.byteOffset,
        endByte:      Number.MAX_SAFE_INTEGER,
        sourceStart:  startFrame.time,
        outputStart:  startFrame.time,
        muted:        false,
        durationSecs: entry.duration - startFrame.time,
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
