import { useTranslation } from '../../i18n/useTranslation'
// ─────────────────────────────────────────────────────────────────────────────
// TrackHeader
//
// Fixed-width (~90px) left-side header for a single track lane.
// Contains: editable name, mute toggle, solo toggle, volume slider,
// color swatch (read-only display), and remove button.
//
// All mutations go through timeline.store (updateTrack / removeTrack).
// Mute and Solo are click-only — no keyboard shortcuts to avoid conflict
// with the global S = Split shortcut.
// ─────────────────────────────────────────────────────────────────────────────

import { trackPresentationColor } from '../../themes/trackColors'
import { Icon } from '../ui/Icon'
import React, { useState, useCallback } from 'react'
import type { Track } from '@shared/project.types'
import { useTimelineStore } from '../../stores/timeline.store'

interface TrackHeaderProps {
  track: Track
  /** Called when user clicks Remove — parent decides whether to confirm. */
  onRemove: (trackId: string) => void
}

export function TrackHeader({ track, onRemove }: TrackHeaderProps) {
  const { t } = useTranslation()
  const updateTrack = useTimelineStore((s) => s.updateTrack)
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(track.name)

  const commitName = useCallback(() => {
    setEditing(false)
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== track.name) {
      updateTrack(track.id, { name: trimmed })
    } else {
      setNameInput(track.name) // revert if empty or unchanged
    }
  }, [nameInput, track.id, track.name, updateTrack])

  return (
    <div className="track-header" style={{ borderLeftColor: trackPresentationColor(track.color) }}>
      <div className="track-heading">
        <span className="track-color" style={{ background: trackPresentationColor(track.color) }} />
        {editing ? (
          <input
            autoFocus
            aria-label={t('waveform.trackName')}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setNameInput(track.name)
                setEditing(false)
              }
              e.stopPropagation()
            }}
          />
        ) : (
          <button
            className="track-name"
            title={t('waveform.rename', { name: track.name })}
            onDoubleClick={() => setEditing(true)}
            onClick={() => setEditing(true)}
          >
            {track.name}
          </button>
        )}
        <button
          className="track-remove"
          title={t('waveform.removeTrack')}
          aria-label={t('waveform.remove', { name: track.name })}
          onClick={() => onRemove(track.id)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="track-controls">
        <button
          aria-label={t('waveform.muteName', { name: track.name })}
          aria-pressed={track.muted}
          title={track.muted ? t('waveform.unmute') : t('waveform.mute')}
          onClick={() => updateTrack(track.id, { muted: !track.muted })}
        >
          M
        </button>
        <button
          aria-label={t('waveform.soloName', { name: track.name })}
          aria-pressed={track.solo}
          title={track.solo ? t('waveform.unsolo') : t('waveform.solo')}
          onClick={() => updateTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
        <input
          type="range"
          aria-label={t('waveform.volumeName', { name: track.name })}
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          style={{ accentColor: trackPresentationColor(track.color) }}
          title={t('waveform.volumePercent', { percent: Math.round(track.volume * 100) })}
        />
        <span>{Math.round(track.volume * 100)}%</span>
      </div>
    </div>
  )
}
