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
      setNameInput(track.name)  // revert if empty or unchanged
    }
  }, [nameInput, track.id, track.name, updateTrack])

  return (
    <div
      style={{
        width: 90,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
        padding: '4px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        backgroundColor: 'var(--color-bg-secondary)',
        userSelect: 'none',
      }}
    >
      {/* Track name */}
      {editing ? (
        <input
          autoFocus
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') { setNameInput(track.name); setEditing(false) }
            e.stopPropagation()  // prevent global keyboard shortcuts
          }}
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-accent)',
            borderRadius: 3,
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-xs)',
            padding: '1px 4px',
            width: '100%',
            outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={() => setEditing(true)}
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'default',
            padding: '1px 0',
          }}
          title={track.name}
        >
          {track.name}
        </div>
      )}

      {/* Color swatch */}
      <div
        style={{
          width: 16,
          height: 4,
          borderRadius: 2,
          backgroundColor: track.color,
          alignSelf: 'flex-start',
        }}
      />

      {/* Mute / Solo */}
      <div style={{ display: 'flex', gap: 3 }}>
        <button
          onClick={() => updateTrack(track.id, { muted: !track.muted })}
          title={track.muted ? 'Unmute' : 'Mute'}
          style={{
            flex: 1,
            fontSize: 9,
            padding: '1px 0',
            border: '1px solid var(--color-border)',
            borderRadius: 2,
            cursor: 'pointer',
            backgroundColor: track.muted ? 'rgba(239,68,68,0.3)' : 'var(--color-bg-elevated)',
            color: track.muted ? 'var(--color-danger)' : 'var(--color-text-muted)',
          }}
        >
          M
        </button>
        <button
          onClick={() => updateTrack(track.id, { solo: !track.solo })}
          title={track.solo ? 'Un-solo' : 'Solo'}
          style={{
            flex: 1,
            fontSize: 9,
            padding: '1px 0',
            border: '1px solid var(--color-border)',
            borderRadius: 2,
            cursor: 'pointer',
            backgroundColor: track.solo ? 'rgba(99,102,241,0.3)' : 'var(--color-bg-elevated)',
            color: track.solo ? 'var(--color-accent)' : 'var(--color-text-muted)',
          }}
        >
          S
        </button>
      </div>

      {/* Volume slider */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={track.volume}
        onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
        style={{ width: '100%', accentColor: track.color, cursor: 'pointer' }}
        title={`Volume: ${Math.round(track.volume * 100)}%`}
      />

      {/* Remove */}
      <button
        onClick={() => onRemove(track.id)}
        title="Remove track"
        style={{
          alignSelf: 'flex-end',
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  )
}
