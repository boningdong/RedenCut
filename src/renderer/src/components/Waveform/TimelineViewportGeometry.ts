// Keep one viewport of scrollable time after the audio, even below fit zoom.
export function getTimelineContentWidth(duration: number, pxPerSec: number, viewportWidth: number) {
  return Math.max(0, duration) * pxPerSec + viewportWidth
}
