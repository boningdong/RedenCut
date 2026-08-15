export interface VisibleWaveformInput {
  outputStart: number
  sourceStart: number
  sourceEnd: number
  pxPerSec: number
  viewportStartPx: number
  viewportWidthPx: number
}

export interface VisibleWaveformRange {
  leftInClipPx: number
  widthPx: number
  sourceStartSeconds: number
  sourceEndSeconds: number
}

export function calculateVisibleWaveformRange(
  input: VisibleWaveformInput,
): VisibleWaveformRange | null {
  const clipDuration = input.sourceEnd - input.sourceStart
  if (clipDuration <= 0 || input.pxPerSec <= 0 || input.viewportWidthPx <= 0) return null
  const clipStartPx = input.outputStart * input.pxPerSec
  const clipEndPx = clipStartPx + clipDuration * input.pxPerSec
  const viewportEndPx = input.viewportStartPx + input.viewportWidthPx
  const visibleStartPx = Math.max(clipStartPx, input.viewportStartPx)
  const visibleEndPx = Math.min(clipEndPx, viewportEndPx)
  if (visibleEndPx <= visibleStartPx) return null
  return {
    leftInClipPx: visibleStartPx - clipStartPx,
    widthPx: visibleEndPx - visibleStartPx,
    sourceStartSeconds: input.sourceStart + (visibleStartPx - clipStartPx) / input.pxPerSec,
    sourceEndSeconds: input.sourceStart + (visibleEndPx - clipStartPx) / input.pxPerSec,
  }
}
