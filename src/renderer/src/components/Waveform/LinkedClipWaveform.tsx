import type { Clip, Track } from '@shared/ProjectTypes'
import { trackPresentationColor } from '../../themes/trackColors'
import { CanvasWaveform } from './CanvasWaveform'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { calculateVisibleWaveformRange } from './waveformRange'

/** Linked lanes show raw recordings; only intervals supplying the Mix are emphasized. */
export function LinkedClipWaveform({
  clip,
  track,
  tracks,
  provider,
  waveformScale,
  pxPerSec,
  viewport,
}: {
  clip: Clip
  track: Track
  tracks: Track[]
  provider?: WaveformDataProvider
  waveformScale?: number
  pxPerSec: number
  viewport: { scrollLeft: number; width: number }
}) {
  const end = clip.outputStart + clip.sourceEnd - clip.sourceStart
  const ranges = tracks
    .filter((item) => item.mixLink?.stemTrackIds.includes(track.id))
    .flatMap((master) =>
      master.clips.flatMap((item) =>
        (item.sourceOverrides ?? [])
          .filter((override) => override.stemTrackIds.includes(track.id))
          .map((override) => ({
            start:
              item.outputStart +
              Math.max(item.sourceStart, override.sourceStart) -
              item.sourceStart,
            end: item.outputStart + Math.min(item.sourceEnd, override.sourceEnd) - item.sourceStart,
          })),
      ),
    )
    .filter((range) => range.end > clip.outputStart && range.start < end)
  const bounds = [
    ...new Set([
      clip.outputStart,
      end,
      ...ranges.flatMap((range) => [
        Math.max(clip.outputStart, range.start),
        Math.min(end, range.end),
      ]),
    ]),
  ].sort((a, b) => a - b)
  const color = trackPresentationColor(track.color)
  return (
    <>
      {bounds.slice(0, -1).map((start, index) => {
        const stop = bounds[index + 1]
        const enabled = ranges.some((range) => range.start <= start && range.end >= stop)
        const visible = calculateVisibleWaveformRange({
          outputStart: start,
          sourceStart: clip.sourceStart + start - clip.outputStart,
          sourceEnd: clip.sourceStart + stop - clip.outputStart,
          pxPerSec,
          viewportStartPx: viewport.scrollLeft,
          viewportWidthPx: viewport.width,
        })
        return (
          <div
            key={start}
            data-source-enabled={enabled}
            style={{
              position: 'absolute',
              left: (start - clip.outputStart) * pxPerSec,
              width: (stop - start) * pxPerSec,
              top: 0,
              bottom: 0,
              opacity: enabled ? 1 : 0.22,
              background: enabled ? `color-mix(in srgb, ${color} 12%, transparent)` : undefined,
              borderTop: enabled ? `2px solid ${color}` : undefined,
              boxSizing: 'border-box',
            }}
          >
            {provider && visible && (
              <CanvasWaveform
                provider={provider}
                amplitudeScale={waveformScale}
                sourceStartSeconds={visible.sourceStartSeconds}
                sourceEndSeconds={visible.sourceEndSeconds}
                leftInClipPx={visible.leftInClipPx}
                widthPx={visible.widthPx}
                color={color}
                muted={false}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
