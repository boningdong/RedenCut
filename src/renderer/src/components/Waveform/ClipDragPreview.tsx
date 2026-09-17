import type { Track } from '@shared/project.types'
import type { ClipPreview } from './UseClipInteraction'
import { trackPresentationColor } from '../../themes/trackColors'

export function ClipDragPreview({
  track,
  original,
  preview,
  pxPerSec,
}: {
  track: Track
  original: Track
  preview: ClipPreview
  pxPerSec: number
}) {
  if (preview.invalid) return null
  return (
    <>
      {track.clips
        .filter((clip) => {
          const prior = original.clips.find((item) => item.id === clip.id)
          return (
            preview.clipIds.includes(clip.id) || !prior || prior.outputStart !== clip.outputStart
          )
        })
        .map((clip) => (
          <div
            key={clip.id}
            className="clip-drag-preview"
            data-clip-preview={clip.id}
            data-shifted={!preview.clipIds.includes(clip.id)}
            style={{
              left: clip.outputStart * pxPerSec,
              width: (clip.sourceEnd - clip.sourceStart) * pxPerSec,
              color: trackPresentationColor(track.color),
            }}
          >
            <span>{track.name}</span>
            <small>{clip.outputStart.toFixed(2)}s</small>
          </div>
        ))}
      {preview.guideTime !== undefined && (
        <div className="clip-snap-guide" style={{ left: preview.guideTime * pxPerSec }} />
      )}
    </>
  )
}
