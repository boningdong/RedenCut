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
  displayProvider,
  waveformScale,
  waveformGain,
  waveformUpdating,
}: {
  clip: Clip
  displayProvider?: WaveformDataProvider
  waveformScale?: number
  waveformGain?: number
  waveformUpdating?: boolean
  onEdit(start: number, end: number): void
  tracks: Track[]
  providers: ReadonlyMap<AudioSourceId, WaveformDataProvider>
  pxPerSec: number
  viewport: { scrollLeft: number; width: number }
}) {
  const { t } = useTranslation()
  const master = tracks.find((track) => track.id === clip.trackId)
  const captionHeight = clip.sourceOverrides?.length ? 17 : 0
  const compositeVisible = displayProvider
    ? calculateVisibleWaveformRange({
        outputStart: clip.outputStart,
        sourceStart: clip.outputStart,
        sourceEnd: clip.outputStart + clip.sourceEnd - clip.sourceStart,
        pxPerSec,
        viewportStartPx: viewport.scrollLeft,
        viewportWidthPx: viewport.width,
      })
    : null
  const spans = resolveSourceSpans(tracks, clip, clip.sourceStart, clip.sourceEnd)
  return (
    <>
      {displayProvider && compositeVisible && (
        <div
          data-processed-waveform="true"
          data-waveform-updating={waveformUpdating || undefined}
          style={{ position: 'absolute', inset: `0 0 ${captionHeight}px` }}
        >
          <CanvasWaveform
            provider={displayProvider}
            sourceStartSeconds={compositeVisible.sourceStartSeconds}
            sourceEndSeconds={compositeVisible.sourceEndSeconds}
            leftInClipPx={compositeVisible.leftInClipPx}
            widthPx={compositeVisible.widthPx}
            amplitudeScale={waveformScale}
            gain={waveformGain}
            color={trackPresentationColor(master?.color ?? '#888888')}
            muted={clip.muted}
          />
        </div>
      )}
      {!displayProvider &&
        spans.map((span, index) => {
          const provider = providers.get(span.audioSourceId)
          const track = tracks.find((item) => item.id === span.trackId)
          if (!provider || !track) return null
          const override = clip.sourceOverrides?.find(
            (item) =>
              Math.round(item.sourceStart * 48000) <= Math.round(span.masterSourceStart * 48000) &&
              Math.round(item.sourceEnd * 48000) >= Math.round(span.masterSourceEnd * 48000),
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
                top: `calc(${override ? (row * 100) / rows : 0}% - ${override ? (row * captionHeight) / rows : 0}px)`,
                height: `calc(${100 / rows}% - ${captionHeight / rows}px)`,
                borderTop: override ? `1px solid ${color}` : undefined,
                boxSizing: 'border-box',
                pointerEvents: 'none',
                overflow: 'hidden',
                background: override ? `color-mix(in srgb, ${color} 8%, transparent)` : undefined,
              }}
            >
              {!displayProvider && (
                <CanvasWaveform
                  provider={provider}
                  sourceStartSeconds={visible.sourceStartSeconds}
                  sourceEndSeconds={visible.sourceEndSeconds}
                  leftInClipPx={visible.leftInClipPx}
                  widthPx={visible.widthPx}
                  amplitudeScale={override ? undefined : waveformScale}
                  gain={waveformGain}
                  topPx={0}
                  color={color}
                  muted={clip.muted}
                />
              )}
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
        const members = override.stemTrackIds
          .map((id) => tracks.find((track) => track.id === id))
          .filter((track): track is Track => !!track)
        const width = (end - start) * pxPerSec
        // Names occupy only a metadata strip, never sequential portions of the time range.
        const showNames =
          width >=
          35 + members.reduce((sum, member) => sum + Math.max(45, member.name.length * 8 + 12), 0)
        return (
          <button
            type="button"
            key={override.id}
            title={label}
            aria-label={label}
            className="mix-replacement-range"
            data-mix-presentation={displayProvider ? 'processed' : 'layered'}
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
            <span
              className="mix-replacement-caption"
              aria-hidden="true"
              style={{ top: 'auto', bottom: 0 }}
            >
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
