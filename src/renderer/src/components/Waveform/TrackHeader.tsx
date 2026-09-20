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
import type { Track } from '@shared/ProjectTypes'
import { useTimelineStore } from '../../stores/TimelineStore'

interface TrackHeaderProps {
  track: Track
  /** Called when user clicks Remove — parent decides whether to confirm. */
  onRemove: (trackId: string) => void
  readOnly?: boolean
  onMixSources?(): void
  collapsed?: boolean
  onToggleChildren?(): void
}

export function TrackHeader({
  track,
  onRemove,
  readOnly = false,
  onMixSources,
  collapsed,
  onToggleChildren,
}: TrackHeaderProps) {
  const { t } = useTranslation()
  const active = useTimelineStore((s) => s.selectedTrackId === track.id)
  const color = trackPresentationColor(track.color)
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
    <div
      className="track-header"
      onClickCapture={() => {
        if (!readOnly) useTimelineStore.getState().setSelectedTrackId(track.id)
      }}
      data-linked-child={readOnly}
      data-active-track={active}
      style={{
        borderLeftColor: color,
        ...(active && {
          background: `color-mix(in srgb, ${color} 12%, var(--color-bg-secondary))`,
          boxShadow: `inset 2px 0 ${color}`,
        }),
      }}
    >
      <div className="track-heading">
        {track.mixLink && (
          <button
            className="mix-collapse"
            aria-label={t(collapsed ? 'waveform.mixExpand' : 'waveform.mixCollapse')}
            aria-expanded={!collapsed}
            onClick={onToggleChildren}
          >
            <Icon
              name="chevron"
              size={12}
              style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
            />
          </button>
        )}
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
            disabled={readOnly}
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
      {readOnly ? (
        <span className="mix-child-label" title={t('waveform.mixReadOnlyHint')}>
          {t('waveform.mixReadOnly')}
        </span>
      ) : (
        <div className="track-controls">
          <button
            aria-label={t('waveform.muteName', { name: track.name })}
            aria-pressed={track.muted}
            title={track.muted ? t('waveform.unmute') : t('waveform.mute')}
            onClick={() => updateTrack(track.id, { muted: !track.muted })}
          >
            <Icon name="mute" size={13} />
          </button>
          <button
            aria-label={t('waveform.soloName', { name: track.name })}
            aria-pressed={track.solo}
            title={track.solo ? t('waveform.unsolo') : t('waveform.solo')}
            onClick={() => updateTrack(track.id, { solo: !track.solo })}
          >
            <Icon name="headphones" size={13} />
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
          <button
            aria-label={t('waveform.mixSources')}
            title={t('waveform.mixSources')}
            aria-pressed={!!track.mixLink}
            onClick={onMixSources}
          >
            <Icon name="hierarchy" size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
