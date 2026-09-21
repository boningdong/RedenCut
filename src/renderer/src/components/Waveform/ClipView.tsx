import React from 'react'
import type { Clip, Track } from '@shared/ProjectTypes'
import { trackPresentationColor } from '../../themes/trackColors'
import { useTranslation } from '../../i18n/useTranslation'
import { CanvasWaveform } from './CanvasWaveform'
import { ClipRedactionOverlay } from './ClipRedactionOverlay'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { calculateVisibleWaveformRange } from './waveformRange'

interface Props {
  clip: Clip
  track: Track
  provider?: WaveformDataProvider
  pxPerSec: number
  viewport: { scrollLeft: number; width: number }
  readOnly?: boolean
  waveform?: React.ReactNode
  selected: boolean
  dimmed: boolean
  onBegin(event: React.PointerEvent, clip: Clip, edge?: 'start' | 'end'): void
  onClick(event: React.MouseEvent, clip: Clip): void
  onTrimKey(event: React.KeyboardEvent<HTMLElement>, clip: Clip, edge: 'start' | 'end'): void
  onFocusTimeline(): void
}
export function ClipView({
  clip,
  track,
  provider,
  pxPerSec,
  viewport,
  readOnly = false,
  waveform,
  selected,
  dimmed,
  onBegin,
  onClick,
  onTrimKey,
  onFocusTimeline,
}: Props) {
  const { t } = useTranslation()
  const visible = provider
    ? calculateVisibleWaveformRange({
        outputStart: clip.outputStart,
        sourceStart: clip.sourceStart,
        sourceEnd: clip.sourceEnd,
        pxPerSec,
        viewportStartPx: viewport.scrollLeft,
        viewportWidthPx: viewport.width,
      })
    : null
  return (
    <div
      className="waveform-clip"
      data-linked-child={readOnly}
      data-selected={selected}
      data-muted={!readOnly && clip.muted}
      data-clip-id={clip.id}
      data-audio-source-id={clip.audioSourceId}
      data-source-start={clip.sourceStart}
      data-source-end={clip.sourceEnd}
      onPointerDown={(event) => {
        if (!readOnly) onBegin(event, clip)
      }}
      onClick={(event) => {
        if (!readOnly) onClick(event, clip)
      }}
      style={
        {
          position: 'absolute',
          left: clip.outputStart * pxPerSec,
          width: (clip.sourceEnd - clip.sourceStart) * pxPerSec,
          top: readOnly ? 6 : 8,
          bottom: readOnly ? 6 : 8,
          borderRadius: 6,
          '--track-color': trackPresentationColor(track.color),
          opacity: dimmed ? 0.28 : undefined,
          cursor: readOnly ? 'default' : 'grab',
          pointerEvents: readOnly ? 'none' : undefined,
          touchAction: 'none',
          zIndex: 5,
          boxSizing: 'border-box',
          overflow: 'hidden',
        } as React.CSSProperties
      }
    >
      {!readOnly && (
        <span className="clip-label" style={{ color: trackPresentationColor(track.color) }}>
          {track.name}
        </span>
      )}
      {waveform ??
        (provider && visible && (
          <CanvasWaveform
            provider={provider}
            sourceStartSeconds={visible.sourceStartSeconds}
            sourceEndSeconds={visible.sourceEndSeconds}
            leftInClipPx={visible.leftInClipPx}
            widthPx={visible.widthPx}
            heightPx={track.mixLink ? 45 : 29}
            color={trackPresentationColor(track.color)}
            muted={clip.muted}
          />
        ))}
      {!readOnly &&
        (clip.redactions ?? []).map((redaction) => (
          <ClipRedactionOverlay
            key={redaction.id}
            clip={clip}
            redaction={redaction}
            pxPerSec={pxPerSec}
            onFocusTimeline={onFocusTimeline}
          />
        ))}
      {!readOnly &&
        (['start', 'end'] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            className={`clip-trim-handle clip-trim-${edge}`}
            aria-label={t(edge === 'start' ? 'waveform.trimStart' : 'waveform.trimEnd')}
            title={t(edge === 'start' ? 'waveform.trimStart' : 'waveform.trimEnd')}
            onKeyDown={(event) => onTrimKey(event, clip, edge)}
            onPointerDown={(event) => onBegin(event, clip, edge)}
            onClick={(event) => event.stopPropagation()}
          />
        ))}
    </div>
  )
}
