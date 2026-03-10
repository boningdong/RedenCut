// ─────────────────────────────────────────────────────────────────────────────
// WaveformView
//
// Wraps wavesurfer.js v7 and connects it to the Zustand playback store.
//
// Key decisions:
//   1. We pass `peaks` + `duration` to wavesurfer instead of a blob/URL.
//      This means wavesurfer NEVER decodes the audio — it uses the pre-generated
//      peak data from the main process. Critical for files > 100 MB.
//
//   2. We pass an HTMLMediaElement (`<audio>` tag) as the `media` option.
//      This tells wavesurfer to use the MediaElement backend for the actual
//      audio, not the Web Audio API backend. The MediaElement can stream large
//      files via file:// URL without loading them into memory.
//
//   3. The wavesurfer instance is stored in a ref (not state) because we don't
//      want React to re-render when it changes. We interact with it imperatively
//      from event handlers and the play/pause button.
//
// Plugins used (v7 plugin API):
//   • Timeline: time markers below the waveform
//   • Minimap: scrollable overview at the top
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.js'
import type { PeakData } from '@shared/project.types'
import { usePlaybackStore } from '../../stores/playback.store'

interface WaveformViewProps {
  /** file:// URL to the audio file (used by the HTMLMediaElement for playback) */
  audioUrl: string
  /** Pre-generated peaks from the main process */
  peaks: PeakData
}

export function WaveformView({ audioUrl, peaks }: WaveformViewProps) {
  // Container div that wavesurfer will render its canvas into
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)

  // The hidden <audio> element — wavesurfer uses it for streaming playback
  const audioRef = useRef<HTMLAudioElement>(null)

  // The wavesurfer instance — stored as ref so it doesn't trigger re-renders
  const wsRef = useRef<WaveSurfer | null>(null)

  const setPlaying = usePlaybackStore((s) => s.setPlaying)
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime)
  const setDuration = usePlaybackStore((s) => s.setDuration)

  // ── Create / destroy wavesurfer instance ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !minimapRef.current || !audioRef.current) return

    // Set the audio source on the media element
    audioRef.current.src = audioUrl

    const ws = WaveSurfer.create({
      container: containerRef.current,

      // Visual appearance — using CSS tokens via JS string values
      waveColor: '#4f46e5',           // --waveform-color
      progressColor: '#818cf8',       // --waveform-progress-color
      cursorColor: 'rgba(255,255,255,0.6)',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,

      // IMPORTANT: pass peaks + duration, not a URL or blob.
      // This prevents wavesurfer from decoding the audio file itself.
      peaks: peaks.data,
      duration: peaks.durationSeconds,

      // Use the HTMLMediaElement for actual audio playback (streaming-safe).
      media: audioRef.current,

      plugins: [
        // Timeline: shows time markers below the waveform
        TimelinePlugin.create({
          container: '#waveform-timeline',
          timeInterval: 10,           // major tick every 10 seconds
          primaryLabelInterval: 60,   // label every 60 seconds
          style: {
            fontSize: '10px',
            color: 'var(--color-text-muted)',
          },
        }),

        // Minimap: compact overview at the top, useful for long files
        MinimapPlugin.create({
          container: minimapRef.current,
          height: 20,
          waveColor: '#3730a3',
          progressColor: '#6366f1',
        }),
      ],
    })

    // ── Event handlers ────────────────────────────────────────────────────
    ws.on('ready', () => {
      setDuration(ws.getDuration())
    })

    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))

    // Update the current time in the store on every animation frame.
    // We use timeupdate (fires ~4x/sec from the media element) rather than
    // requestAnimationFrame to avoid unnecessary work.
    ws.on('timeupdate', (time) => setCurrentTime(time))

    wsRef.current = ws

    setWaveSurferInstance(ws)

    return () => {
      ws.destroy()
      wsRef.current = null
      setWaveSurferInstance(null)
    }
    // Re-create when audioUrl or peaks change (i.e. user opens a different file)
  }, [audioUrl, peaks]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Minimap — scrollable overview */}
      <div
        ref={minimapRef}
        style={{
          borderBottom: '1px solid var(--color-border-subtle)',
          backgroundColor: 'var(--color-bg-primary)',
        }}
      />

      {/* Main waveform canvas */}
      <div
        ref={containerRef}
        style={{ padding: '8px 0', cursor: 'crosshair' }}
      />

      {/* Timeline ruler */}
      <div
        id="waveform-timeline"
        style={{
          borderTop: '1px solid var(--color-border-subtle)',
          paddingBottom: 4,
        }}
      />

      {/* Hidden audio element — wavesurfer uses this for streaming playback */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  )
}

// ── Imperative handle ─────────────────────────────────────────────────────────
// The TransportBar needs to control playback. We expose the wavesurfer ref
// via a module-level getter so TransportBar can call ws.playPause() without
// prop drilling or context. In Phase 2 we'll put this in the playback store.
let _wsInstance: WaveSurfer | null = null

export function getWaveSurferInstance(): WaveSurfer | null {
  return _wsInstance
}

// We need to update this when the ref changes — use a callback ref pattern
export function setWaveSurferInstance(ws: WaveSurfer | null): void {
  _wsInstance = ws
}
