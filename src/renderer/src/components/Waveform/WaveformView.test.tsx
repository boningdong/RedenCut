// @vitest-environment jsdom

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IElectronAPI } from '@shared/ipc.types'
import type { PeakData } from '@shared/project.types'
import { setAudioPlayerInstance } from '@shared/player.types'
import { useEditorStore } from '../../stores/editor.store'
import { usePlaybackStore } from '../../stores/playback.store'
import { useTimelineStore } from '../../stores/timeline.store'
import { useTranscriptStore } from '../../stores/transcript.store'
import { PeakDataProvider } from './PeakDataProvider'
import { WaveformView } from './WaveformView'

const originalCanvasGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'getContext',
)
const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
  globalThis,
  'requestAnimationFrame',
)
const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
  globalThis,
  'cancelAnimationFrame',
)
const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
const originalElectronAPI = Object.getOwnPropertyDescriptor(window, 'electronAPI')

const TEN_MINUTE_SECONDS = 600
const ONE_HOUR_SECONDS = 3_600
const TEN_MINUTE_PEAK_COUNT = 114_000
const ONE_HOUR_PEAK_COUNT = 684_000
const VIEWPORT_CSS_PIXELS = 800
const DEVICE_PIXEL_RATIO = 2
const VIEWPORT_DEVICE_PIXELS = VIEWPORT_CSS_PIXELS * DEVICE_PIXEL_RATIO

const peaks: PeakData = {
  data: [[0.25, 0.5, 0.75, 1, 0.5, 0.25, 0.75, 0.5]],
  durationSeconds: 4,
  length: 8,
}

function recordingContext() {
  return {
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
  }
}

function structuralPeakData(durationSeconds: number, peakCount: number): PeakData {
  return {
    data: [Array.from({ length: peakCount }, (_, index) => ((index * 17) % 1_000) / 1_000)],
    durationSeconds,
    length: peakCount,
  }
}

function restoreProperty(target: object, name: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor)
  } else {
    Reflect.deleteProperty(target, name)
  }
}

describe('WaveformView canvas integration', () => {
  let context: ReturnType<typeof recordingContext>
  let animationFrameId: number
  let animationFrames: Map<number, FrameRequestCallback>
  let requestAnimationFrameSpy: ReturnType<typeof vi.fn>
  let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    useEditorStore.getState().reset()
    usePlaybackStore.getState().reset()
    useTimelineStore.getState().reset()
    useTranscriptStore.getState().reset()
    setAudioPlayerInstance(null)
    useTimelineStore.getState().initFromFile('/audio/source.wav', peaks.durationSeconds)

    context = recordingContext()
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => context),
    })

    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        readonly callback: ResizeObserverCallback

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback
        }

        observe(target: Element) {
          this.callback(
            [{ contentRect: { width: 800 }, target } as unknown as ResizeObserverEntry],
            this,
          )
        }

        disconnect() {}
        unobserve() {}
      },
    })

    animationFrameId = 0
    animationFrames = new Map()
    requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
      animationFrameId += 1
      animationFrames.set(animationFrameId, callback)
      return animationFrameId
    })
    cancelAnimationFrameSpy = vi.fn((id: number) => {
      animationFrames.delete(id)
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrameSpy,
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: cancelAnimationFrameSpy,
    })
  })

  afterEach(() => {
    setAudioPlayerInstance(null)
    vi.restoreAllMocks()
  })

  afterAll(() => {
    restoreProperty(HTMLCanvasElement.prototype, 'getContext', originalCanvasGetContext)
    restoreProperty(globalThis, 'ResizeObserver', originalResizeObserver)
    restoreProperty(globalThis, 'requestAnimationFrame', originalRequestAnimationFrame)
    restoreProperty(globalThis, 'cancelAnimationFrame', originalCancelAnimationFrame)
    restoreProperty(window, 'devicePixelRatio', originalDevicePixelRatio)
    restoreProperty(window, 'electronAPI', originalElectronAPI)
  })

  it('renders loaded peak data as one visible canvas without peak SVG or a hidden host', async () => {
    const { container } = render(<WaveformView peaks={peaks} />)

    await waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(1))

    const canvas = container.querySelector('canvas')
    expect(canvas?.closest('[style*="opacity: 0"]')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-lane] > div[style*="opacity: 0"]')).toBeNull()
  })

  it('renders both clips after splitting one loaded source', async () => {
    const firstClip = useTimelineStore.getState().tracks[0].clips[0]
    useTimelineStore.getState().setSelectedClipId(firstClip.id)
    useTimelineStore.getState().splitAt(2)

    const { container } = render(<WaveformView peaks={peaks} />)

    await waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(2))
    expect(container.querySelector('svg')).toBeNull()
  })

  it.each([
    {
      fixture: '10-minute',
      durationSeconds: TEN_MINUTE_SECONDS,
      peakCount: TEN_MINUTE_PEAK_COUNT,
      visibleTrackCount: 1,
    },
    {
      fixture: '10-minute',
      durationSeconds: TEN_MINUTE_SECONDS,
      peakCount: TEN_MINUTE_PEAK_COUNT,
      visibleTrackCount: 4,
    },
    {
      fixture: 'one-hour',
      durationSeconds: ONE_HOUR_SECONDS,
      peakCount: ONE_HOUR_PEAK_COUNT,
      visibleTrackCount: 1,
    },
    {
      fixture: 'one-hour',
      durationSeconds: ONE_HOUR_SECONDS,
      peakCount: ONE_HOUR_PEAK_COUNT,
      visibleTrackCount: 4,
    },
  ])(
    'bounds reads and drawing to target device pixels per visible track for a $fixture source on $visibleTrackCount track(s)',
    async ({ durationSeconds, peakCount, visibleTrackCount }) => {
      const fixturePeaks = structuralPeakData(durationSeconds, peakCount)
      useTimelineStore.getState().initFromFile('/audio/shared-source.wav', durationSeconds)
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: DEVICE_PIXEL_RATIO,
      })

      const trackContexts: ReturnType<typeof recordingContext>[] = []
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: vi.fn(() => {
          const trackContext = recordingContext()
          trackContexts.push(trackContext)
          return trackContext
        }),
      })
      const openFile = vi.fn(async () => ({
        filePath: '/audio/shared-source.wav',
        metadata: {
          durationSeconds,
          sampleRate: 48_000,
          channels: 2,
          codec: 'pcm_s16le',
          bitrateKbps: 1_536,
        },
      }))
      const generatePeaks = vi.fn(async () => fixturePeaks)
      Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        value: { audio: { openFile, generatePeaks } } as unknown as IElectronAPI,
      })
      const readRange = vi.spyOn(PeakDataProvider.prototype, 'readRange')
      const { container, getByText } = render(<WaveformView peaks={fixturePeaks} />)

      for (
        let expectedTrackCount = 2;
        expectedTrackCount <= visibleTrackCount;
        expectedTrackCount++
      ) {
        fireEvent.click(getByText('+ Add Track'))
        await waitFor(() =>
          expect(container.querySelectorAll('canvas')).toHaveLength(expectedTrackCount),
        )
      }

      await waitFor(() => {
        expect(readRange).toHaveBeenCalledTimes(visibleTrackCount)
        expect(trackContexts).toHaveLength(visibleTrackCount)
        expect(trackContexts.every(({ fillRect }) => fillRect.mock.calls.length > 0)).toBe(true)
      })

      expect(openFile).toHaveBeenCalledTimes(visibleTrackCount - 1)
      expect(generatePeaks).toHaveBeenCalledTimes(visibleTrackCount - 1)
      for (const [request] of readRange.mock.calls) {
        expect(request.targetPixelWidth).toBe(VIEWPORT_DEVICE_PIXELS)
        expect(request.sourceStartSeconds).toBe(0)
        expect(request.sourceEndSeconds).toBeCloseTo(durationSeconds)
      }
      for (const { fillRect } of trackContexts) {
        expect(fillRect.mock.calls.length).toBeLessThanOrEqual(VIEWPORT_DEVICE_PIXELS)
      }
    },
  )

  it('does not request or redraw static waveform pixels when the playhead advances', async () => {
    const readRange = vi.spyOn(PeakDataProvider.prototype, 'readRange')
    render(<WaveformView peaks={peaks} />)

    await waitFor(() => expect(readRange).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(context.fillRect).toHaveBeenCalled())
    const initialClearCount = context.clearRect.mock.calls.length
    const initialDrawCount = context.fillRect.mock.calls.length

    act(() => usePlaybackStore.getState().setCurrentTime(2))
    await act(async () => Promise.resolve())

    expect(readRange).toHaveBeenCalledTimes(1)
    expect(context.clearRect).toHaveBeenCalledTimes(initialClearCount)
    expect(context.fillRect).toHaveBeenCalledTimes(initialDrawCount)
  })

  it('coalesces scroll events into one waveform update per animation frame', async () => {
    const readRange = vi.spyOn(PeakDataProvider.prototype, 'readRange')
    const { container } = render(<WaveformView peaks={peaks} />)
    await waitFor(() => expect(readRange).toHaveBeenCalledTimes(1))
    const viewport = container.querySelector('[data-lane]')?.parentElement?.parentElement
    expect(viewport).toBeInstanceOf(HTMLDivElement)

    if (!viewport) throw new Error('Expected timeline viewport')
    viewport.scrollLeft = 20
    fireEvent.scroll(viewport)
    viewport.scrollLeft = 40
    fireEvent.scroll(viewport)
    viewport.scrollLeft = 60
    fireEvent.scroll(viewport)

    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)
    act(() => {
      const queued = [...animationFrames.entries()]
      animationFrames.clear()
      for (const [, callback] of queued) callback(0)
    })
    await waitFor(() => expect(readRange).toHaveBeenCalledTimes(2))
  })

  it('cancels a queued scroll update when the view unmounts', () => {
    const { container, unmount } = render(<WaveformView peaks={peaks} />)
    const viewport = container.querySelector('[data-lane]')?.parentElement?.parentElement
    expect(viewport).toBeInstanceOf(HTMLDivElement)

    if (!viewport) throw new Error('Expected timeline viewport')
    fireEvent.scroll(viewport)
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1)

    unmount()

    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1)
  })
})
