import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WaveformBucketRange, WaveformDataProvider } from './WaveformDataProvider'
import { WaveformRequestController } from './WaveformRequestController'
import { drawWaveform } from './drawWaveform'
import { fittedWaveformScale } from './WaveformDisplayState'

export interface CanvasWaveformProps {
  provider: WaveformDataProvider
  sourceStartSeconds: number
  sourceEndSeconds: number
  leftInClipPx: number
  widthPx: number
  heightPx?: number
  amplitudeScale?: number
  gain?: number
  topPx?: number
  color: string
  muted: boolean
}

export const CanvasWaveform = React.memo(function CanvasWaveform({
  provider,
  sourceStartSeconds,
  sourceEndSeconds,
  leftInClipPx,
  widthPx,
  heightPx,
  amplitudeScale,
  gain = 1,
  topPx,
  color,
  muted,
}: CanvasWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestControllerRef = useRef<WaveformRequestController | null>(null)
  if (!requestControllerRef.current) requestControllerRef.current = new WaveformRequestController()

  const [availableHeight, setAvailableHeight] = useState(0)
  useLayoutEffect(() => {
    if (heightPx !== undefined) return
    const parent = canvasRef.current?.parentElement
    if (!parent) return
    const measure = () => setAvailableHeight(parent.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [heightPx])
  const resolvedHeight = Math.max(0, heightPx ?? availableHeight)

  const devicePixelRatio = window.devicePixelRatio || 1
  const backingWidth = Math.ceil(widthPx * devicePixelRatio)
  const backingHeight = Math.ceil(resolvedHeight * devicePixelRatio)

  const [cachedRange, setCachedRange] = useState<{
    provider: WaveformDataProvider
    start: number
    end: number
    width: number
    range: WaveformBucketRange
  } | null>(null)
  const [sourceScale, setSourceScale] = useState<{
    provider: WaveformDataProvider
    value: number
  } | null>(null)
  const needsSourceScale = amplitudeScale === undefined

  useEffect(() => {
    if (!needsSourceScale) return
    let active = true
    // Never fit a visible range, even if original peak metadata is unavailable.
    void (provider.getPeak?.() ?? Promise.resolve(0))
      .then(fittedWaveformScale, () => 1)
      .then((value) => {
        if (active) setSourceScale({ provider, value })
      })
    return () => {
      active = false
    }
  }, [provider, needsSourceScale])

  useEffect(() => {
    void requestControllerRef.current?.request(
      provider,
      sourceStartSeconds,
      sourceEndSeconds,
      backingWidth,
      (range) =>
        setCachedRange({
          provider,
          start: sourceStartSeconds,
          end: sourceEndSeconds,
          width: backingWidth,
          range,
        }),
    )
    return () => requestControllerRef.current?.cancel()
  }, [provider, sourceStartSeconds, sourceEndSeconds, backingWidth])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    canvas.dataset.waveformReady = 'false'
    canvas.dataset.visualOverflow = 'false'
    const resolvedScale =
      amplitudeScale ?? (sourceScale?.provider === provider ? sourceScale.value : undefined)
    if (
      !cachedRange ||
      cachedRange.provider !== provider ||
      cachedRange.start !== sourceStartSeconds ||
      cachedRange.end !== sourceEndSeconds ||
      cachedRange.width !== backingWidth ||
      resolvedScale === undefined
    ) {
      context.clearRect(0, 0, backingWidth, backingHeight)
      return
    }
    const overflow = drawWaveform(
      context,
      cachedRange.range.buckets,
      backingWidth,
      backingHeight,
      color,
      devicePixelRatio,
      resolvedScale,
      gain,
    )
    canvas.dataset.visualOverflow = String(overflow)
    if (overflow) {
      context.fillStyle = color
      context.fillRect(0, 0, backingWidth, devicePixelRatio)
      context.fillRect(0, backingHeight - devicePixelRatio, backingWidth, devicePixelRatio)
    }
    canvas.dataset.waveformReady = String(
      cachedRange.range.buckets.length > 0 && backingWidth > 0 && backingHeight > 0,
    )
  }, [
    cachedRange,
    sourceScale,
    amplitudeScale,
    gain,
    backingHeight,
    backingWidth,
    color,
    devicePixelRatio,
    provider,
    sourceEndSeconds,
    sourceStartSeconds,
  ])

  return (
    <canvas
      ref={canvasRef}
      data-waveform-ready="false"
      data-visual-overflow="false"
      width={backingWidth}
      height={backingHeight}
      style={{
        position: 'absolute',
        top: topPx ?? '50%',
        transform: topPx === undefined ? 'translateY(-50%)' : undefined,
        opacity: muted ? 0.55 : 1,
        left: leftInClipPx,
        width: widthPx,
        height: resolvedHeight,
      }}
    />
  )
})
