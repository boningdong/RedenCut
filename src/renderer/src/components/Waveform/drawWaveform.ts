import type { WaveformBucket } from './WaveformDataProvider'

export interface WaveformDrawingContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): CanvasGradient
  beginPath?(): void
  roundRect?(x: number, y: number, width: number, height: number, radius: number): void
  fill?(): void
}

function amplitude(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}

/** Aggregate cached buckets into spaced bars, retaining each group's acoustic extrema. */
export function drawWaveform(
  context: WaveformDrawingContext,
  buckets: readonly WaveformBucket[],
  width: number,
  height: number,
  color: string,
  pixelRatio = 1,
  amplitudeScale = 1,
  gain = 1,
): boolean {
  context.clearRect(0, 0, width, height)
  context.fillStyle = color
  if (width <= 0 || height <= 0 || buckets.length === 0) return false
  let overflow = false
  const multiplier = amplitudeScale * gain
  const gradients = new Map<number, CanvasGradient>()
  const edgeFade = Math.min((8 * pixelRatio) / height, 0.25)
  const highlight = (edges: number) => {
    if (!context.createLinearGradient) return undefined
    let gradient = gradients.get(edges)
    if (!gradient) {
      gradient = context.createLinearGradient(0, 0, 0, height)
      const clear = 'rgba(255, 255, 255, 0)'
      const bright = 'rgba(255, 255, 255, 0.45)'
      gradient.addColorStop(0, edges & 1 ? bright : clear)
      gradient.addColorStop(edgeFade, clear)
      gradient.addColorStop(1 - edgeFade, clear)
      gradient.addColorStop(1, edges & 2 ? bright : clear)
      gradients.set(edges, gradient)
    }
    return gradient
  }
  const count = Math.min(buckets.length, Math.max(1, Math.floor(width / (3 * pixelRatio))))
  const step = width / count
  const barWidth = Math.min(1.5 * pixelRatio, step)
  for (let index = 0; index < count; index++) {
    let edges = 0
    let min = 1,
      max = -1
    const start = Math.floor((index * buckets.length) / count)
    const end = Math.floor(((index + 1) * buckets.length) / count)
    for (let bucket = start; bucket < end; bucket++) {
      const low = buckets[bucket].min * multiplier
      const high = buckets[bucket].max * multiplier
      if (Number.isFinite(high) && high > 1) edges |= 1
      if (Number.isFinite(low) && low < -1) edges |= 2
      min = Math.min(min, amplitude(low))
      max = Math.max(max, amplitude(high))
    }
    overflow ||= edges !== 0
    context.fillStyle = color
    const top = Math.min(height - Math.min(pixelRatio, height), ((1 - max) / 2) * height)
    const bottom = ((1 - min) / 2) * height
    const barHeight = Math.min(height - top, Math.max(Math.min(pixelRatio, height), bottom - top))
    const left = index * step + (step - barWidth) / 2
    if (context.beginPath && context.roundRect && context.fill) {
      context.beginPath()
      context.roundRect(left, top, barWidth, barHeight, barWidth / 2)
      context.fill()
    } else context.fillRect(left, top, barWidth, barHeight)
    const gradient = edges ? highlight(edges) : undefined
    if (gradient) {
      // Tint only the existing bar path; neighboring bars and empty gaps stay separate.
      context.fillStyle = gradient
      if (context.beginPath && context.roundRect && context.fill) context.fill()
      else context.fillRect(left, top, barWidth, barHeight)
    }
  }
  context.fillStyle = color
  return overflow
}
