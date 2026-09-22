import React, { useEffect, useRef } from 'react'
import type { WaveformDataProvider } from './WaveformDataProvider'
import { WaveformRequestController } from './WaveformRequestController'
import { drawWaveform } from './drawWaveform'

export interface CanvasWaveformProps {
  provider: WaveformDataProvider
  sourceStartSeconds: number
  sourceEndSeconds: number
  leftInClipPx: number
  widthPx: number
  heightPx: number
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
  topPx,
  color,
  muted,
}: CanvasWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestControllerRef = useRef<WaveformRequestController | null>(null)
  if (!requestControllerRef.current) requestControllerRef.current = new WaveformRequestController()

  const devicePixelRatio = window.devicePixelRatio || 1
  const backingWidth = Math.ceil(widthPx * devicePixelRatio)
  const backingHeight = Math.ceil(heightPx * devicePixelRatio)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) canvas.dataset.waveformReady = 'false'
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    void requestControllerRef.current?.request(
      provider,
      sourceStartSeconds,
      sourceEndSeconds,
      backingWidth,
      (range) => {
        drawWaveform(context, range.buckets, backingWidth, backingHeight, color, devicePixelRatio)
        canvas.dataset.waveformReady = String(
          range.buckets.length > 0 && backingWidth > 0 && backingHeight > 0,
        )
      },
    )

    return () => {
      canvas.dataset.waveformReady = 'false'
      requestControllerRef.current?.cancel()
    }
  }, [
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
      width={backingWidth}
      height={backingHeight}
      style={{
        position: 'absolute',
        top: topPx ?? '50%',
        transform: topPx === undefined ? 'translateY(-50%)' : undefined,
        opacity: muted ? 0.55 : 1,
        left: leftInClipPx,
        width: widthPx,
        height: heightPx,
      }}
    />
  )
})
