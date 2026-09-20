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
}: {
  clip: Clip
  tracks: Track[]
  providers: ReadonlyMap<AudioSourceId, WaveformDataProvider>
  pxPerSec: number
  viewport: { scrollLeft: number; width: number }
}) {
  const { t } = useTranslation()
  const spans = resolveSourceSpans(tracks, clip, clip.sourceStart, clip.sourceEnd)
  return (
    <>
      {spans.map((span, index) => {
        const provider = providers.get(span.audioSourceId)
        const track = tracks.find((item) => item.id === span.trackId)
        if (!provider || !track) return null
        const override = clip.sourceOverrides?.find(
          (item) =>
            item.sourceStart <= span.masterSourceStart && item.sourceEnd >= span.masterSourceEnd,
        )
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
              top: row * (29 / rows),
              bottom: 0,
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
              heightPx={29 / rows}
              color={color}
              muted={clip.muted}
            />
          </div>
        )
      })}
      {(clip.sourceOverrides ?? []).map((override) => {
        const start = Math.max(clip.sourceStart, override.sourceStart)
        const end = Math.min(clip.sourceEnd, override.sourceEnd)
        if (end <= start) return null
        const names = override.stemTrackIds
          .map((id) => tracks.find((track) => track.id === id)?.name ?? '')
          .join(' + ')
        const label = t('waveform.mixReplacementLabel', { names })
        return (
          <div
            key={override.id}
            className="mix-replacement-range"
            style={{ left: (start - clip.sourceStart) * pxPerSec, width: (end - start) * pxPerSec }}
          >
            <span title={label}>{label}</span>
          </div>
        )
      })}
    </>
  )
}
