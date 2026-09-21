import { useEditorHistoryStore } from '../../stores/EditorHistoryStore'
import { useTranslation } from '../../i18n/useTranslation'
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
import { togglePlayback } from '../../actions/PlaybackActions'
import { usePlaybackStore } from '../../stores/PlaybackStore'
import { useEditorStore } from '../../stores/editor.store'
import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import { useTimelineStore } from '../../stores/TimelineStore'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const fraction = Math.floor((seconds % 1) * 100)
    .toString()
    .padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${fraction}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${fraction}`
}

export function TransportBar({
  workspaceControls,
  onOpenSettings,
}: {
  workspaceControls?: React.ReactNode
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  const historyBusy = useEditorHistoryStore((s) => s.busy)
  const canUndo = useTimelineStore((s) => s.undoStack.length > 0)
  const canRedo = useTimelineStore((s) => s.redoStack.length > 0)
  const undo = useTimelineStore((s) => s.undo)
  const redo = useTimelineStore((s) => s.redo)
  const hasAudio = useTimelineStore((s) => s.tracks.some((track) => track.clips.length > 0))
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const outputTime = usePlaybackStore((s) => s.outputCurrentTime)
  const outputDuration = usePlaybackStore((s) => s.outputDuration)

  const previewMode = useEditorStore((s) => s.previewMode)
  const togglePreviewMode = useEditorStore((s) => s.togglePreviewMode)

  const handleSkipToStart = useCallback(() => {
    getAudioPlayerInstance()?.seekTo(0)
  }, [])

  const handleSkipToEnd = useCallback(() => {
    const player = getAudioPlayerInstance()
    if (player) player.seekTo(player.getDuration())
  }, [])

  return (
    <div className="transport-bar">
      <div className="transport-history">
        {workspaceControls}
        <Button
          size="sm"
          variant="ghost"
          disabled={!canUndo || historyBusy}
          onClick={() => {
            void undo()
          }}
          aria-label={t('transport.undo')}
          title={t('transport.undoHint')}
        >
          <Icon name="undo" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canRedo || historyBusy}
          onClick={() => {
            void redo()
          }}
          aria-label={t('transport.redo')}
          title={t('transport.redoHint')}
        >
          <Icon name="redo" />
        </Button>
      </div>
      <div className="transport-playback">
        {/* Skip to start */}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSkipToStart}
          disabled={!hasAudio}
          aria-label={t('transport.start')}
          title={t('transport.start')}
        >
          <SkipBackIcon />
        </Button>

        {/* Play / Pause */}
        <Button
          size="sm"
          variant="primary"
          className="transport-play"
          onClick={() => {
            void togglePlayback().catch((error: unknown) => {
              console.error('[TransportBar] Failed to toggle playback:', error)
            })
          }}
          disabled={!hasAudio}
          aria-label={isPlaying ? t('transport.pause') : t('transport.play')}
          title={isPlaying ? t('transport.pauseHint') : t('transport.playHint')}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </Button>

        {/* Skip to end */}
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSkipToEnd}
          disabled={!hasAudio}
          aria-label={t('transport.end')}
          title={t('transport.end')}
        >
          <SkipForwardIcon />
        </Button>
      </div>
      <div className="transport-trailing">
        <div className="transport-time">
          <span>{formatTime(outputTime)}</span>
          <small>/ {formatTime(outputDuration)}</small>
        </div>
        <div className="transport-options">
          <Button
            size="sm"
            className="transport-preview"
            onClick={togglePreviewMode}
            aria-pressed={previewMode}
            aria-label={t('transport.preview')}
            title={t('transport.previewHint')}
          >
            <Icon name="preview" />
            {t('transport.previewEdits')}
          </Button>
          <Button
            size="sm"
            className="transport-settings"
            onClick={onOpenSettings}
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            <Icon name="gear" size={18} />
          </Button>
        </div>
      </div>
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
