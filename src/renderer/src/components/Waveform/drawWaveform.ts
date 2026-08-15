import type { WaveformBucket } from './WaveformDataProvider'

export interface WaveformDrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
}

function amplitude(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}

export function drawWaveform(
  context: WaveformDrawingContext,
  buckets: readonly WaveformBucket[],
  width: number,
  height: number,
  color: string,
): void {
  context.clearRect(0, 0, width, height)
  context.fillStyle = color
  if (width <= 0 || height <= 0 || buckets.length === 0) return

  const bucketWidth = width / buckets.length
  buckets.forEach((bucket, index) => {
    const top = ((1 - amplitude(bucket.max)) / 2) * height
    const bottom = ((1 - amplitude(bucket.min)) / 2) * height
    context.fillRect(index * bucketWidth, top, Math.max(1, bucketWidth), Math.max(1, bottom - top))
  })
}
