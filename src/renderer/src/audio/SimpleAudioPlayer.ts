// ─────────────────────────────────────────────────────────────────────────────
// SimpleAudioPlayer — Phase 1 IAudioPlayer implementation
//
// Strategy:
//   • One HTMLAudioElement per source file, served via podcut:// protocol
//   • All elements connected to a shared AudioContext via createMediaElementSource()
//     → per-element GainNode → destination
//   • Playback is driven by the FIRST source file's <audio> element (single-track
//     for now; multi-track mixing comes in WebCodecsPlayer Phase 2)
//   • Real-time muting: each animation frame, we check which clips are currently
//     active and whether they are muted → set GainNode.gain.value = 0 or 1
//   • onTimeUpdate fires on every rAF tick while playing, and also immediately
//     after seekTo() so the waveform cursor stays in sync
//
// Limitations (acceptable for Phase 1):
//   • <audio> element plays linearly — muted clips play silently rather than
//     being skipped (true skip is Phase 2 / WebCodecsPlayer)
//   • Multi-track mixing is not supported; only Track 0 drives time
//   • GainNode transitions are instant (no crossfade) — acceptable for preview
//
// Thread safety: all Web Audio API calls happen on the renderer main thread.
// ─────────────────────────────────────────────────────────────────────────────

import type { IAudioPlayer } from '@shared/player.types'
import type { Track } from '@shared/project.types'

// ── Internal per-source entry ─────────────────────────────────────────────────
interface SourceEntry {
  element:  HTMLAudioElement
  source:   MediaElementAudioSourceNode
  gainNode: GainNode
  duration: number   // seconds, 0 until loadedmetadata fires
}

// ── SimpleAudioPlayer ─────────────────────────────────────────────────────────
export class SimpleAudioPlayer implements IAudioPlayer {
  // ── Web Audio graph ───────────────────────────────────────────────────────
  private ctx: AudioContext | null = null

  // Map from sourceFileId → entry
  private sources = new Map<string, SourceEntry>()

  // The primary source file ID — the one whose <audio> element drives time
  private primarySourceId: string | null = null

  // ── Track model ───────────────────────────────────────────────────────────
  private tracks: Track[] = []

  // ── Playback state ────────────────────────────────────────────────────────
  private _isPlaying = false
  private _rafId: number | null = null

  // ── Callbacks ─────────────────────────────────────────────────────────────
  private timeUpdateCbs    = new Set<(t: number) => void>()
  private playStateCbs     = new Set<(p: boolean) => void>()
  private durationChangeCbs = new Set<(d: number) => void>()
  private endedCbs         = new Set<() => void>()

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext()
      console.log('[SimpleAudioPlayer] AudioContext created, sampleRate:', this.ctx.sampleRate)
    }
    return this.ctx
  }

  private get primaryElement(): HTMLAudioElement | null {
    if (!this.primarySourceId) return null
    return this.sources.get(this.primarySourceId)?.element ?? null
  }

  // ── IAudioPlayer — loadSourceFile ─────────────────────────────────────────

  async loadSourceFile(id: string, filePath: string): Promise<void> {
    if (this.sources.has(id)) {
      console.log(`[SimpleAudioPlayer] loadSourceFile: already loaded id=${id}`)
      return
    }

    console.log(`[SimpleAudioPlayer] loadSourceFile id=${id} path=${filePath}`)

    const ctx = this.getCtx()
    const element = new Audio()
    element.crossOrigin = 'anonymous'
    element.preload = 'metadata'

    const source   = ctx.createMediaElementSource(element)
    const gainNode = ctx.createGain()
    gainNode.gain.value = 1

    source.connect(gainNode)
    gainNode.connect(ctx.destination)

    const entry: SourceEntry = { element, source, gainNode, duration: 0 }
    this.sources.set(id, entry)

    // Set first loaded source as primary
    if (!this.primarySourceId) {
      this.primarySourceId = id
      console.log(`[SimpleAudioPlayer] primary source set to id=${id}`)
    }

    // Wire element events
    element.addEventListener('ended', () => {
      console.log(`[SimpleAudioPlayer] ended — source id=${id}`)
      this._isPlaying = false
      this.stopRaf()
      this.emitPlayState(false)
      this.emitTimeUpdate(this.getCurrentTime())
      this.endedCbs.forEach(cb => cb())
    })

    // Wait for enough metadata to know duration
    await new Promise<void>((resolve, reject) => {
      const onMeta = () => {
        entry.duration = element.duration || 0
        console.log(`[SimpleAudioPlayer] loadedmetadata id=${id} duration=${entry.duration}s`)
        if (id === this.primarySourceId) {
          this.durationChangeCbs.forEach(cb => cb(entry.duration))
        }
        cleanup()
        resolve()
      }
      const onError = () => {
        console.error(`[SimpleAudioPlayer] error loading id=${id}`, element.error)
        cleanup()
        reject(new Error(`Failed to load audio: ${filePath} (${element.error?.message ?? 'unknown'})`))
      }
      const cleanup = () => {
        element.removeEventListener('loadedmetadata', onMeta)
        element.removeEventListener('error', onError)
      }

      element.addEventListener('loadedmetadata', onMeta)
      element.addEventListener('error', onError)

      // Construct podcut:// URL — same format as App.tsx audioUrl.
      // The protocol handler expects: podcut://localhost/<encodedAbsolutePath>
      const url = `podcut://localhost/${encodeURIComponent(filePath)}`
      console.log(`[SimpleAudioPlayer] setting src=${url}`)
      element.src = url
      element.load()
    })
  }

  // ── IAudioPlayer — setTracks ──────────────────────────────────────────────

  setTracks(tracks: Track[]): void {
    this.tracks = tracks
    console.log(`[SimpleAudioPlayer] setTracks — ${tracks.length} tracks, total clips:`,
      tracks.reduce((n, t) => n + t.clips.length, 0))
    // Update gain immediately based on current time
    this.updateGains()
  }

  // ── IAudioPlayer — playback control ──────────────────────────────────────

  async play(): Promise<void> {
    const el = this.primaryElement
    if (!el) {
      console.warn('[SimpleAudioPlayer] play() called but no primary element')
      return
    }
    const ctx = this.getCtx()
    if (ctx.state === 'suspended') {
      console.log('[SimpleAudioPlayer] resuming AudioContext')
      await ctx.resume()
    }
    console.log('[SimpleAudioPlayer] play() currentTime=', el.currentTime)
    await el.play()
    this._isPlaying = true
    this.emitPlayState(true)
    this.startRaf()
  }

  pause(): void {
    const el = this.primaryElement
    if (!el) return
    console.log('[SimpleAudioPlayer] pause() currentTime=', el.currentTime)
    el.pause()
    this._isPlaying = false
    this.stopRaf()
    this.emitPlayState(false)
    this.emitTimeUpdate(el.currentTime)
  }

  async playPause(): Promise<void> {
    if (this._isPlaying) {
      this.pause()
    } else {
      await this.play()
    }
  }

  seekTo(outputTime: number): void {
    const el = this.primaryElement
    if (!el) return
    // Phase 1: output time === source time (single file, no clip rearrangement)
    const clamped = Math.max(0, Math.min(outputTime, el.duration || 0))
    console.log(`[SimpleAudioPlayer] seekTo outputTime=${outputTime} clamped=${clamped}`)
    el.currentTime = clamped
    this.updateGains()
    this.emitTimeUpdate(clamped)
  }

  // ── IAudioPlayer — state queries ──────────────────────────────────────────

  getCurrentTime(): number {
    return this.primaryElement?.currentTime ?? 0
  }

  getDuration(): number {
    if (!this.primarySourceId) return 0
    return this.sources.get(this.primarySourceId)?.duration ?? 0
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

  // ── IAudioPlayer — lifecycle ──────────────────────────────────────────────

  destroy(): void {
    console.log('[SimpleAudioPlayer] destroy()')
    this.stopRaf()
    for (const [id, entry] of this.sources) {
      entry.element.pause()
      entry.element.src = ''
      entry.source.disconnect()
      entry.gainNode.disconnect()
      console.log(`[SimpleAudioPlayer] destroyed source id=${id}`)
    }
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

  // ── rAF loop ──────────────────────────────────────────────────────────────

  private startRaf(): void {
    if (this._rafId !== null) return

    const tick = () => {
      if (!this._isPlaying) return
      const el = this.primaryElement
      if (el) {
        this.updateGains()
        this.emitTimeUpdate(el.currentTime)
      }
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

  // ── Gain management ───────────────────────────────────────────────────────
  //
  // Each animation frame we look at the current output time and check every
  // source entry: is there an active clip that is muted at this position?
  // If so, set gain=0; otherwise gain=1.
  //
  // "Active" means: there exists a non-muted clip on a non-muted, non-solo-
  // excluded track whose outputStart..outputEnd window contains currentTime.
  //
  // Phase 1 simplification: we only support one source file, so we set the
  // single GainNode based on whether the primary clip at currentTime is muted.

  private updateGains(): void {
    if (this.sources.size === 0 || this.tracks.length === 0) return

    const t = this.getCurrentTime()

    // Determine solo mode — if any track is soloed, only soloed tracks play
    const anySolo = this.tracks.some(tr => tr.solo)

    for (const [sourceId, entry] of this.sources) {
      let gain = 0  // default: silent until we find an active unmuted clip

      for (const track of this.tracks) {
        // Skip muted tracks or non-solo tracks when solo mode is active
        if (track.muted) continue
        if (anySolo && !track.solo) continue

        for (const clip of track.clips) {
          if (clip.sourceFileId !== sourceId) continue

          const outputEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
          if (t < clip.outputStart || t >= outputEnd) continue

          // This clip is active at time t
          if (!clip.muted) {
            gain = track.volume * clip.gain
          }
          // If clip is muted, gain stays 0 for this source
        }
      }

      const current = entry.gainNode.gain.value
      if (Math.abs(current - gain) > 0.001) {
        // Instant transition — no ramp to keep things simple for Phase 1
        entry.gainNode.gain.setValueAtTime(gain, this.ctx?.currentTime ?? 0)
      }
    }
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  private emitTimeUpdate(t: number): void {
    this.timeUpdateCbs.forEach(cb => cb(t))
  }

  private emitPlayState(playing: boolean): void {
    this.playStateCbs.forEach(cb => cb(playing))
  }
}
