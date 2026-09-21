import { useTranslation } from '../../i18n/useTranslation'
import type { AudioSourceId, Clip, Track } from '@shared/ProjectTypes'
import { resolveSourceSpans } from '@shared/SourceRouting'
import { trackPresentationColor } from '../../themes/trackColors'
import { CanvasWaveform } from './CanvasWaveform'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { calculateVisibleWaveformRange } from './waveformRange'

/** Draw the same source intervals the Mix plays, retaining the master's hit targets. */
export function MixClipWaveform({
  clip,
  tracks,
  providers,
  pxPerSec,
  viewport,
  onEdit,
}: {
  clip: Clip
  onEdit(start: number, end: number): void
  tracks: Track[]
  providers: ReadonlyMap<AudioSourceId, WaveformDataProvider>
  pxPerSec: number
  viewport: { scrollLeft: number; width: number }
}) {
  const { t } = useTranslation()
  const master = tracks.find((track) => track.id === clip.trackId)
  const waveformHeight = master?.mixLink ? 45 : 29
  const spans = resolveSourceSpans(tracks, clip, clip.sourceStart, clip.sourceEnd)
  return (
    <>
      {spans.map((span, index) => {
        const provider = providers.get(span.audioSourceId)
        const track = tracks.find((item) => item.id === span.trackId)
        if (!provider || !track) return null
        const override = clip.sourceOverrides?.find(
          (item) =>
            Math.round(item.sourceStart * 48000) <= Math.round(span.masterSourceStart * 48000) &&
            Math.round(item.sourceEnd * 48000) >= Math.round(span.masterSourceEnd * 48000),
        )
        if (override && override.stemTrackIds.length > 3) return null
        const row = override?.stemTrackIds.indexOf(span.trackId) ?? 0
        const rows = override?.stemTrackIds.length ?? 1
        const outputStart = clip.outputStart + span.masterSourceStart - clip.sourceStart
        const visible = calculateVisibleWaveformRange({
          outputStart,
          sourceStart: span.sourceStart,
          sourceEnd: span.sourceEnd,
          pxPerSec,
          viewportStartPx: viewport.scrollLeft,
          viewportWidthPx: viewport.width,
        })
        if (!visible) return null
        const color = trackPresentationColor(track.color)
        return (
          <div
            key={index}
            data-source-override={override?.id}
            data-waveform-track={track.id}
            style={{
              position: 'absolute',
              left: (outputStart - clip.outputStart) * pxPerSec,
              width: (span.sourceEnd - span.sourceStart) * pxPerSec,
              top: override ? 16 + row * (waveformHeight / rows) : 0,
              height: override ? waveformHeight / rows : waveformHeight + 16,
              borderTop: override ? `2px solid ${color}` : undefined,
              boxSizing: 'border-box',
              pointerEvents: 'none',
              overflow: 'hidden',
              background: override ? `color-mix(in srgb, ${color} 8%, transparent)` : undefined,
            }}
          >
            <CanvasWaveform
              provider={provider}
              sourceStartSeconds={visible.sourceStartSeconds}
              sourceEndSeconds={visible.sourceEndSeconds}
              leftInClipPx={visible.leftInClipPx}
              widthPx={visible.widthPx}
              heightPx={override ? waveformHeight / rows - 2 : waveformHeight}
              topPx={override ? 0 : 16}
              color={color}
              muted={clip.muted}
            />
          </div>
        )
      })}
      {(clip.sourceOverrides ?? []).map((override) => {
        const layered = override.stemTrackIds.length <= 3
        const start = Math.max(clip.sourceStart, override.sourceStart)
        const end = Math.min(clip.sourceEnd, override.sourceEnd)
        if (end <= start) return null
        const names = override.stemTrackIds
          .map((id) => tracks.find((track) => track.id === id)?.name ?? '')
          .join(' + ')
        const label = t('waveform.mixReplacementLabel', { names })
        const members = override.stemTrackIds
          .map((id) => tracks.find((track) => track.id === id))
          .filter((track): track is Track => !!track)
        const width = (end - start) * pxPerSec
        // Names occupy only a metadata strip, never sequential portions of the time range.
        const showNames =
          members.length <= 3 &&
          width >=
            35 + members.reduce((sum, member) => sum + Math.max(45, member.name.length * 8 + 12), 0)
        return (
          <button
            type="button"
            key={override.id}
            title={label}
            aria-label={label}
            className="mix-replacement-range"
            data-mix-presentation={layered ? 'layered' : 'combined'}
            style={{ left: (start - clip.sourceStart) * pxPerSec, width }}
            onPointerDown={(event) => {
              if (!event.altKey) event.stopPropagation()
            }}
            onClick={(event) => {
              if (event.altKey) return
              event.stopPropagation()
              onEdit(
                clip.outputStart + start - clip.sourceStart,
                clip.outputStart + end - clip.sourceStart,
              )
            }}
            onContextMenu={(event) => {
              onEdit(
                clip.outputStart + start - clip.sourceStart,
                clip.outputStart + end - clip.sourceStart,
              )
              // Bubble to the lane's replacement context menu after selecting this interval.
              event.preventDefault()
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {!layered && (
              <svg
                className="mix-illustrative-wave"
                viewBox="0 0 240 28"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {Array.from({ length: 60 }, (_, i) => {
                  const h = 3 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.21)) * 23
                  return <path key={i} d={`M${i * 4 + 2} ${14 - h / 2}v${h}`} />
                })}
              </svg>
            )}
            <span className="mix-replacement-caption" aria-hidden="true">
              {width >= 120 && <small>{t('waveform.mixReplaceShort')}</small>}
              <span className="mix-participant-tags">
                {members.map((member) => (
                  <span
                    key={member.id}
                    className="mix-participant"
                    style={{ color: trackPresentationColor(member.color) }}
                  >
                    <i />
                    {showNames && member.name}
                  </span>
                ))}
              </span>
              {!showNames && (
                <span className="mix-participant-count">
                  {t('waveform.mixParticipants', { count: members.length })}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </>
  )
}
