// ─────────────────────────────────────────────────────────────────────────────
// TransportBar
//
// Play/pause controls, time display, and Preview Mode toggle.
// Placement is owned by EditorWorkspace.
//
// All playback control goes through IAudioPlayer.
// Playback state (isPlaying, currentTime, duration) comes from playback.store
// which is updated by App.tsx subscribing to the player's callbacks.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react'
import { usePlaybackStore } from '../../stores/playback.store'
import { useEditorStore } from '../../stores/editor.store'
import { getAudioPlayerInstance } from '@shared/player.types'
import { useTimelineStore } from '../../stores/timeline.store'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useThemeStore } from '../../stores/theme.store'

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function TransportBar() {
  const canUndo = useTimelineStore((s) => s.undoStack.length > 0)
  const canRedo = useTimelineStore((s) => s.redoStack.length > 0)
  const undo = useTimelineStore((s) => s.undo)
  const redo = useTimelineStore((s) => s.redo)
  const hasAudio = useTimelineStore((s) => s.tracks.some((track) => track.clips.length > 0))
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration = usePlaybackStore((s) => s.duration)

  const previewMode = useEditorStore((s) => s.previewMode)
  const togglePreviewMode = useEditorStore((s) => s.togglePreviewMode)

  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  const handlePlayPause = useCallback(async () => {
    const player = getAudioPlayerInstance()
    if (!player) return

    if (!player.isPlaying() && previewMode) {
      // Preview Mode: if playhead is inside a muted clip, skip to its end before playing
      const time = player.getCurrentTime()
      const clips = useTimelineStore.getState().tracks.flatMap((t) => t.clips)
      const inside = clips.find((c) => {
        if (!c.muted) return false
        const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
        return time >= c.outputStart && time < outputEnd
      })
      if (inside) {
        const outputEnd = inside.outputStart + (inside.sourceEnd - inside.sourceStart)
        player.seekTo(outputEnd)
      }
    }

    await player.playPause()
  }, [previewMode])

  const handleSkipToStart = useCallback(() => {
    getAudioPlayerInstance()?.seekTo(0)
  }, [])

  const handleSkipToEnd = useCallback(() => {
    const player = getAudioPlayerInstance()
    if (player) player.seekTo(player.getDuration())
  }, [])

  return (
    <div
      className="transport-bar"
      style={{
        height: 48,
        backgroundColor: 'var(--color-bg-secondary)',

        display: 'flex',
        alignItems: 'center',
        paddingInline: 'var(--space-4)',
        gap: 'var(--space-3)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* Skip to start */}
      <Button
        size="sm"
        variant="ghost"
        onClick={handleSkipToStart}
        disabled={!hasAudio}
        aria-label="Skip to start"
        title="Skip to start"
      >
        <SkipBackIcon />
      </Button>

      {/* Play / Pause */}
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          void handlePlayPause().catch((error: unknown) => {
            console.error('[TransportBar] Failed to toggle playback:', error)
          })
        }}
        disabled={!hasAudio}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </Button>

      {/* Skip to end */}
      <Button
        size="sm"
        variant="ghost"
        onClick={handleSkipToEnd}
        disabled={!hasAudio}
        aria-label="Skip to end"
        title="Skip to end"
      >
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

      <span className="transport-separator" />
      <Button size="sm" disabled={!canUndo} onClick={undo} aria-label="Undo" title="Undo (⌘Z)">
        <Icon name="undo" />
      </Button>
      <Button size="sm" disabled={!canRedo} onClick={redo} aria-label="Redo" title="Redo (⇧⌘Z)">
        <Icon name="redo" />
      </Button>
      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Preview Mode toggle */}
      <button
        onClick={togglePreviewMode}
        aria-pressed={previewMode}
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

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        style={{
          background: 'none',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          cursor: 'pointer',
          padding: '0 10px',
          height: 28,
          fontSize: 14,
          color: 'var(--color-text-muted)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
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
