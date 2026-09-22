import { useTranslation } from '../../i18n/useTranslation'
import { trackPresentationColor } from '../../themes/trackColors'
import { Icon } from '../ui/Icon'
import React, { useState, useCallback, type CSSProperties } from 'react'
import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import { getNormalizeEffect } from '@shared/TrackEffects'
import { TrackLevelControl } from './TrackLevelControl'
import { TrackEffectsMenu } from './TrackEffectsMenu'
import { EditorContextMenu } from '../ui/EditorContextMenu'
import './TrackHeader.css'
import { useWaveformDisplayStore } from './WaveformDisplayState'
import type { Track } from '@shared/ProjectTypes'
import { useTimelineStore } from '../../stores/TimelineStore'

interface TrackHeaderProps {
  track: Track
  /** Called when user clicks Remove — parent decides whether to confirm. */
  onRemove: (trackId: string) => void
  readOnly?: boolean
  onMixSources?(): void
  collapsed?: boolean
  linkedNames?: string
  parentName?: string
  onToggleChildren?(): void
  onFitWaveform?(): void
  onResetWaveform?(): void
}

export function TrackHeader({
  track,
  onRemove,
  readOnly = false,
  onMixSources,
  collapsed,
  onToggleChildren,
  linkedNames,
  parentName,
  onFitWaveform,
  onResetWaveform,
}: TrackHeaderProps) {
  const { t } = useTranslation()
  const active = useTimelineStore((s) => s.selectedTrackId === track.id)
  const color = trackPresentationColor(track.color)
  const updateTrack = useTimelineStore((s) => s.updateTrack)
  const setTrackGain = useTimelineStore((s) => s.setTrackGain)
  const setTrackVolume = useTimelineStore((s) => s.setTrackVolume)
  const toggleTrackNormalize = useTimelineStore((s) => s.toggleTrackNormalize)
  const [context, setContext] = useState<{ x: number; y: number } | null>(null)
  const closeContext = useCallback(() => setContext(null), [])
  const restoreTrackPreview = useCallback(() => {
    useWaveformDisplayStore.getState().previewGain(track.id)
    getAudioPlayerInstance()?.setTracks(useTimelineStore.getState().tracks)
  }, [track.id])
  const previewTrackLevel = (setting: 'gainDb' | 'volume', value: number) => {
    if (setting === 'gainDb') useWaveformDisplayStore.getState().previewGain(track.id, value)
    getAudioPlayerInstance()?.setTracks(
      useTimelineStore
        .getState()
        .tracks.map((item) => (item.id === track.id ? { ...item, [setting]: value } : item)),
    )
  }
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
      tabIndex={0}
      aria-label={t('waveform.trackActions', { name: track.name })}
      onContextMenu={(event) => {
        event.preventDefault()
        setContext({ x: event.clientX, y: event.clientY })
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          setContext({ x: rect.left + 10, y: rect.bottom })
        }
      }}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('.track-remove')) return
        if (!readOnly) useTimelineStore.getState().setSelectedTrackId(track.id)
      }}
      data-linked-child={readOnly}
      data-active-track={active}
      style={
        {
          '--track-color': color,
          borderLeftColor: color,
          ...(active && {
            background: `color-mix(in srgb, ${color} 12%, var(--color-bg-secondary))`,
            boxShadow: `inset 2px 0 ${color}`,
          }),
        } as CSSProperties
      }
    >
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
            disabled={readOnly}
            title={t('waveform.rename', { name: track.name })}
            onClick={() => {
              setNameInput(track.name)
              setEditing(true)
            }}
          >
            {track.name}
          </button>
        )}
        {track.mixLink && <span className="mix-role">{t('waveform.mixMaster')}</span>}
        <button
          type="button"
          className="track-remove"
          title={t('waveform.removeTrack')}
          aria-label={t('waveform.remove', { name: track.name })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove(track.id)
          }}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      {readOnly ? (
        <span
          className="mix-child-label"
          title={`${parentName ?? ''} · ${t('waveform.mixReadOnlyHint')}`}
        >
          {t('waveform.mixReadOnly')}
        </span>
      ) : (
        <div className="track-controls">
          <button
            aria-label={t('waveform.mixSources')}
            title={t('waveform.mixSources')}
            aria-pressed={!!track.mixLink}
            onClick={onMixSources}
          >
            <Icon name="hierarchy" size={14} />
          </button>
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
          <TrackLevelControl
            kind="volume"
            name={track.name}
            value={track.volume}
            onPreview={(value) => previewTrackLevel('volume', value)}
            onCancelPreview={restoreTrackPreview}
            onCommit={(value) => setTrackVolume(track.id, value)}
          />
          <TrackEffectsMenu
            active={track.effects.some((effect) => effect.enabled)}
            normalized={!!getNormalizeEffect(track)}
            onToggleNormalize={() => toggleTrackNormalize(track.id)}
          />
          <TrackLevelControl
            kind="gain"
            name={track.name}
            value={track.gainDb ?? 0}
            onPreview={(value) => previewTrackLevel('gainDb', value)}
            onCancelPreview={restoreTrackPreview}
            onCommit={(value) => {
              setTrackGain(track.id, value)
              useWaveformDisplayStore.getState().previewGain(track.id)
            }}
          />
        </div>
      )}
      {context && (
        <EditorContextMenu
          {...context}
          onClose={closeContext}
          items={[
            ...(onFitWaveform
              ? [{ id: 'fit-waveform', label: t('waveform.fitWaveform'), action: onFitWaveform }]
              : []),
            ...(onResetWaveform
              ? [
                  {
                    id: 'reset-waveform',
                    label: t('waveform.resetWaveform'),
                    action: onResetWaveform,
                  },
                ]
              : []),
            ...(track.mixLink && onToggleChildren
              ? [
                  {
                    id: 'collapse',
                    label: t(collapsed ? 'waveform.mixExpand' : 'waveform.mixCollapse'),
                    action: onToggleChildren,
                  },
                ]
              : []),
            { id: 'remove', label: t('waveform.removeTrack'), action: () => onRemove(track.id) },
          ]}
        />
      )}
      {track.mixLink && (
        <span className="mix-members" title={linkedNames}>
          {t('waveform.mixMemberCount', { count: track.mixLink.stemTrackIds.length })}
          {collapsed && linkedNames ? ` · ${linkedNames}` : ''}
        </span>
      )}
    </div>
  )
}
