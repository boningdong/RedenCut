// ─────────────────────────────────────────────────────────────────────────────
// TransportBar
//
// Play/pause controls, time display, and Preview Mode toggle.
// Lives at the bottom of the app.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react'
import { usePlaybackStore } from '../../stores/playback.store'
import { useEditorStore } from '../../stores/editor.store'
import { getWaveSurferInstance } from '../Waveform/WaveformView'
import { Button } from '../ui/Button'

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function TransportBar() {
  const isPlaying   = usePlaybackStore((s) => s.isPlaying)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration    = usePlaybackStore((s) => s.duration)

  const previewMode      = useEditorStore((s) => s.previewMode)
  const togglePreviewMode = useEditorStore((s) => s.togglePreviewMode)

  const handlePlayPause = useCallback(() => {
    const ws = getWaveSurferInstance()
    if (!ws) return

    // Preview Mode: if about to play and playhead is inside a muted region,
    // jump to the end of that region before playing.
    if (!ws.isPlaying() && previewMode) {
      const { edits } = useEditorStore.getState()
      const time = ws.getCurrentTime()
      const muted = edits.filter((e) => e.type === 'mute')
      const inside = muted.find((e) => time >= e.start && time < e.end)
      if (inside) ws.setTime(inside.end)
    }

    ws.playPause()
  }, [previewMode])

  const handleSkipToStart = useCallback(() => {
    getWaveSurferInstance()?.seekTo(0)
  }, [])

  const handleSkipToEnd = useCallback(() => {
    getWaveSurferInstance()?.seekTo(1)
  }, [])

  return (
    <div
      style={{
        height: 48,
        backgroundColor: 'var(--color-bg-secondary)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        paddingInline: 'var(--space-4)',
        gap: 'var(--space-3)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* Skip to start */}
      <Button size="sm" variant="ghost" onClick={handleSkipToStart} title="Skip to start">
        <SkipBackIcon />
      </Button>

      {/* Play / Pause */}
      <Button size="sm" variant="primary" onClick={handlePlayPause} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </Button>

      {/* Skip to end */}
      <Button size="sm" variant="ghost" onClick={handleSkipToEnd} title="Skip to end">
        <SkipForwardIcon />
      </Button>

      {/* Time display */}
      <div
        style={{
          marginLeft: 'var(--space-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
          fontVariantNumeric: 'tabular-nums',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
        }}
      >
        <span style={{ color: 'var(--color-text-primary)' }}>{formatTime(currentTime)}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>/</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Preview Mode toggle */}
      <button
        onClick={togglePreviewMode}
        title="Preview Mode: skip muted regions during playback"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: `1px solid ${previewMode ? 'var(--color-accent)' : 'var(--color-border)'}`,
          borderRadius: 4,
          color: previewMode ? 'var(--color-accent)' : 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
          padding: '3px 8px',
          cursor: 'pointer',
          letterSpacing: '0.04em',
          transition: 'color 0.15s, border-color 0.15s',
        }}
      >
        {/* Dot indicator */}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: previewMode ? 'var(--color-accent)' : 'var(--color-text-muted)',
            flexShrink: 0,
            transition: 'background-color 0.15s',
          }}
        />
        Preview
      </button>
    </div>
  )
}

// ── Minimal SVG icons ─────────────────────────────────────────────────────────
function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  )
}

function SkipBackIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="19,20 9,12 19,4" />
      <rect x="5" y="4" width="3" height="16" />
    </svg>
  )
}

function SkipForwardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,4 15,12 5,20" />
      <rect x="16" y="4" width="3" height="16" />
    </svg>
  )
}
