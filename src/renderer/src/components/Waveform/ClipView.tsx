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
      data-selected={selected}
      data-muted={clip.muted}
      data-clip-id={clip.id}
      data-audio-source-id={clip.audioSourceId}
      data-source-start={clip.sourceStart}
      data-source-end={clip.sourceEnd}
      onPointerDown={(event) => onBegin(event, clip)}
      onClick={(event) => onClick(event, clip)}
      style={
        {
          position: 'absolute',
          left: clip.outputStart * pxPerSec,
          width: (clip.sourceEnd - clip.sourceStart) * pxPerSec,
          top: 8,
          bottom: 8,
          borderRadius: 6,
          '--track-color': trackPresentationColor(track.color),
          opacity: dimmed ? 0.28 : undefined,
          cursor: 'grab',
          touchAction: 'none',
          zIndex: 5,
          boxSizing: 'border-box',
          overflow: 'hidden',
        } as React.CSSProperties
      }
    >
      <span className="clip-label" style={{ color: trackPresentationColor(track.color) }}>
        {track.name}
      </span>
      {provider && visible && (
        <CanvasWaveform
          provider={provider}
          sourceStartSeconds={visible.sourceStartSeconds}
          sourceEndSeconds={visible.sourceEndSeconds}
          leftInClipPx={visible.leftInClipPx}
          widthPx={visible.widthPx}
          heightPx={29}
          color={trackPresentationColor(track.color)}
          muted={clip.muted}
        />
      )}
      {(clip.redactions ?? []).map((redaction) => (
        <ClipRedactionOverlay
          key={redaction.id}
          clip={clip}
          redaction={redaction}
          pxPerSec={pxPerSec}
          onFocusTimeline={onFocusTimeline}
        />
      ))}
      {(['start', 'end'] as const).map((edge) => (
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
