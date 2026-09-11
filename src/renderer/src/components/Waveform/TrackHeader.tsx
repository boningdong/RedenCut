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
            aria-label="Track name"
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
            title={`Rename ${track.name}`}
            onDoubleClick={() => setEditing(true)}
            onClick={() => setEditing(true)}
          >
            {track.name}
          </button>
        )}
        <button
          className="track-remove"
          title="Remove track"
          aria-label={`Remove ${track.name}`}
          onClick={() => onRemove(track.id)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="track-controls">
        <button
          aria-label={`Mute ${track.name}`}
          aria-pressed={track.muted}
          title={track.muted ? 'Unmute' : 'Mute'}
          onClick={() => updateTrack(track.id, { muted: !track.muted })}
        >
          M
        </button>
        <button
          aria-label={`Solo ${track.name}`}
          aria-pressed={track.solo}
          title={track.solo ? 'Un-solo' : 'Solo'}
          onClick={() => updateTrack(track.id, { solo: !track.solo })}
        >
          S
        </button>
        <input
          type="range"
          aria-label={`${track.name} volume`}
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          style={{ accentColor: trackPresentationColor(track.color) }}
          title={`Volume: ${Math.round(track.volume * 100)}%`}
        />
        <span>{Math.round(track.volume * 100)}%</span>
      </div>
    </div>
  )
}
