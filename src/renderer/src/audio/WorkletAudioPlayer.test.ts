// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioSampleChunk, AudioSampleProvider } from '@shared/player.types'
import type { AudioSourceId, Track } from '@shared/project.types'
import { WorkletAudioPlayer } from './WorkletAudioPlayer'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001' as AudioSourceId

class FakePort {
  static autoAcknowledge = true
  onmessage: ((event: MessageEvent) => void) | null = null
  messages: { message: Record<string, unknown>; transfer?: Transferable[] }[] = []
  private acceptedFrames = new Map<number, number>()
  private queuedFrames = new Map<number, number>()
  postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
    this.messages.push({ message, transfer })
    if (FakePort.autoAcknowledge && message.type === 'pcm') {
      const generation = message.generation as number
      const frames = (message.channels as Float32Array[])[0].length
      const acceptedFrames = (this.acceptedFrames.get(generation) ?? 0) + frames
      const queuedFrames = (this.queuedFrames.get(generation) ?? 0) + frames
      this.acceptedFrames.set(generation, acceptedFrames)
      this.queuedFrames.set(generation, queuedFrames)
      queueMicrotask(() =>
        this.onmessage?.({
          data: { type: 'depth', generation, queuedFrames, acceptedFrames },
        } as MessageEvent),
      )
    }
  }

  setQueuedFrames(generation: number, queuedFrames: number): void {
    this.queuedFrames.set(generation, queuedFrames)
  }
}

class FakeNode {
  static instances: FakeNode[] = []
  port = new FakePort()
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() {
    FakeNode.instances.push(this)
  }
}

class FakeContext {
  currentTime = 0
  sampleRate = 48_000
  state = 'running'
  destination = {}
  audioWorklet = { addModule: vi.fn(async () => undefined) }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  }
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
}

function track(id: string, outputStart = 0, sourceEnd = 5): Track {
  return {
    id,
    name: id,
    volume: 1,
    muted: false,
    solo: false,
    color: '#fff',
    effects: [],
    clips: [
      {
        id: `clip-${id}`,
        trackId: id,
        audioSourceId: SOURCE_ID,
        sourceStart: 0,
        sourceEnd,
        outputStart,
        gain: 1,
        muted: false,
        effects: [],
      },
    ],
  }
}

function acknowledgePrefill(node: FakeNode): void {
  const pcm = node.port.messages.filter(({ message }) => message.type === 'pcm')
  const generation = pcm[0]!.message.generation as number
  const acceptedFrames = pcm.reduce(
    (total, { message }) => total + (message.channels as Float32Array[])[0].length,
    0,
  )
  node.port.onmessage?.({
    data: { type: 'depth', generation, queuedFrames: acceptedFrames, acceptedFrames },
  } as MessageEvent)
}

function sentPcmFrames(node: FakeNode): number {
  return node.port.messages
    .filter(({ message }) => message.type === 'pcm')
    .reduce((total, { message }) => total + (message.channels as Float32Array[])[0].length, 0)
}

function provider(): AudioSampleProvider {
  return {
    audioSourceId: SOURCE_ID,
    format: 'f32-planar',
    sampleRate: 48_000,
    channels: 1,
    frameCount: 48_000 * 10,
    readFrames: vi.fn(async (startFrame, frameCount) => ({
      startFrame,
      frameCount,
      channels: [new Float32Array(frameCount)],
    })),
  }
}

describe('WorkletAudioPlayer bounded scheduling', () => {
  beforeEach(() => {
    FakeNode.instances = []
    FakePort.autoAcknowledge = true
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('AudioWorkletNode', FakeNode)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worklet')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => vi.unstubAllGlobals())

  it('waits for every worklet prefill acknowledgement before posting play', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one'), track('two')])
    let settled = false
    const playback = player.play().then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(2))
    await vi.waitFor(() =>
      expect(
        FakeNode.instances.every((node) =>
          node.port.messages.some(({ message }) => message.type === 'pcm'),
        ),
      ).toBe(true),
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(
      FakeNode.instances.some((node) =>
        node.port.messages.some(({ message }) => message.type === 'play'),
      ),
    ).toBe(false)
    player.destroy()
    await expect(playback).resolves.toBeUndefined()
  })

  it('releases every active queue only after each current generation acknowledges prefill', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one'), track('two')])
    const playback = player.play()
    await vi.waitFor(() =>
      expect(
        FakeNode.instances.filter((node) =>
          node.port.messages.some(({ message }) => message.type === 'pcm'),
        ),
      ).toHaveLength(2),
    )
    acknowledgePrefill(FakeNode.instances[0])
    await Promise.resolve()
    expect(
      FakeNode.instances.some((node) =>
        node.port.messages.some(({ message }) => message.type === 'play'),
      ),
    ).toBe(false)
    acknowledgePrefill(FakeNode.instances[1])
    await expect(playback).resolves.toBeUndefined()
    expect(
      FakeNode.instances.every((node) =>
        node.port.messages.some(({ message }) => message.type === 'play'),
      ),
    ).toBe(true)
    player.destroy()
  })

  it('starts a finite short plan after its complete planned frame count is acknowledged', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('short', 0, 1)])
    const playback = player.play()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(1))
    const node = FakeNode.instances[0]
    await vi.waitFor(() =>
      expect(
        node.port.messages
          .filter(({ message }) => message.type === 'pcm')
          .reduce(
            (total, { message }) => total + (message.channels as Float32Array[])[0].length,
            0,
          ),
      ).toBe(48_000),
    )
    acknowledgePrefill(node)
    await expect(playback).resolves.toBeUndefined()
    expect(node.port.messages.some(({ message }) => message.type === 'play')).toBe(true)
    player.destroy()
  })

  it('ignores stale generation acknowledgements after a seek and posts play only to replacement queues', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const playback = player.play()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(1))
    const stale = FakeNode.instances[0]
    await vi.waitFor(() =>
      expect(stale.port.messages.some(({ message }) => message.type === 'pcm')).toBe(true),
    )
    player.seekTo(2)
    await expect(playback).resolves.toBeUndefined()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(2))
    const replacement = FakeNode.instances[1]
    await vi.waitFor(() => expect(sentPcmFrames(replacement)).toBe(96_000))
    acknowledgePrefill(stale)
    await Promise.resolve()
    expect(stale.port.messages.some(({ message }) => message.type === 'play')).toBe(false)
    expect(replacement.port.messages.some(({ message }) => message.type === 'play')).toBe(false)
    acknowledgePrefill(replacement)
    await vi.waitFor(() =>
      expect(replacement.port.messages.some(({ message }) => message.type === 'play')).toBe(true),
    )
    player.destroy()
  })

  it('cancels withheld prefill on structural rebuild without a late play post', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const playback = player.play()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(1))
    const stale = FakeNode.instances[0]
    player.setTracks([track('one'), track('two')])
    await expect(playback).resolves.toBeUndefined()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(3))
    expect(stale.port.messages.some(({ message }) => message.type === 'play')).toBe(false)
    await vi.waitFor(() =>
      expect(FakeNode.instances.slice(1).every((node) => sentPcmFrames(node) === 96_000)).toBe(
        true,
      ),
    )
    for (const node of FakeNode.instances.slice(1)) acknowledgePrefill(node)
    await vi.waitFor(() =>
      expect(
        FakeNode.instances
          .slice(1)
          .every((node) => node.port.messages.some(({ message }) => message.type === 'play')),
      ).toBe(true),
    )
    player.destroy()
  })

  it('cancels withheld prefill on destroy without posting play or rejecting publicly', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const playback = player.play()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(1))
    player.destroy()
    await expect(playback).resolves.toBeUndefined()
    expect(FakeNode.instances[0].port.messages.some(({ message }) => message.type === 'play')).toBe(
      false,
    )
  })

  it('cancels play when destroyed while the initial worklet module is loading', async () => {
    let releaseModule: (() => void) | undefined
    class DelayedContext extends FakeContext {
      private firstModule = true
      audioWorklet = {
        addModule: vi.fn(() => {
          if (!this.firstModule) return Promise.resolve(undefined)
          this.firstModule = false
          return new Promise<undefined>((resolve) => {
            releaseModule = () => resolve(undefined)
          })
        }),
      }
    }
    vi.stubGlobal('AudioContext', DelayedContext)
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const playback = player.play()
    await vi.waitFor(() => expect(releaseModule).toBeTypeOf('function'))
    player.destroy()
    releaseModule!()
    await expect(playback).resolves.toBeUndefined()
    expect(FakeNode.instances).toHaveLength(0)
  })

  it('waits for the initial worklet module before creating a seek replacement queue', async () => {
    FakePort.autoAcknowledge = false
    let releaseModule: (() => void) | undefined
    class DelayedContext extends FakeContext {
      audioWorklet = {
        addModule: vi.fn(
          () =>
            new Promise<undefined>((resolve) => {
              releaseModule = () => resolve(undefined)
            }),
        ),
      }
    }
    vi.stubGlobal('AudioContext', DelayedContext)
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const initialPlay = player.play()
    await vi.waitFor(() => expect(releaseModule).toBeTypeOf('function'))
    player.seekTo(2)
    await Promise.resolve()
    expect(FakeNode.instances).toHaveLength(0)
    releaseModule!()
    await expect(initialPlay).resolves.toBeUndefined()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(1))
    const replacement = FakeNode.instances[0]
    await vi.waitFor(() => expect(sentPcmFrames(replacement)).toBe(96_000))
    acknowledgePrefill(replacement)
    await vi.waitFor(() =>
      expect(replacement.port.messages.some(({ message }) => message.type === 'play')).toBe(true),
    )
    expect(player.getCurrentTime()).toBe(2)
    player.destroy()
  })

  it('waits for the initial worklet module before applying structural tracks', async () => {
    FakePort.autoAcknowledge = false
    let releaseModule: (() => void) | undefined
    class DelayedContext extends FakeContext {
      audioWorklet = {
        addModule: vi.fn(
          () =>
            new Promise<undefined>((resolve) => {
              releaseModule = () => resolve(undefined)
            }),
        ),
      }
    }
    vi.stubGlobal('AudioContext', DelayedContext)
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const playback = player.play()
    await vi.waitFor(() => expect(releaseModule).toBeTypeOf('function'))
    player.setTracks([track('one'), track('two')])
    await Promise.resolve()
    expect(FakeNode.instances).toHaveLength(0)
    releaseModule!()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(2))
    await vi.waitFor(() =>
      expect(FakeNode.instances.every((node) => sentPcmFrames(node) === 96_000)).toBe(true),
    )
    for (const node of FakeNode.instances) acknowledgePrefill(node)
    await expect(playback).resolves.toBeUndefined()
    expect(
      FakeNode.instances.every((node) =>
        node.port.messages.some(({ message }) => message.type === 'play'),
      ),
    ).toBe(true)
    player.destroy()
  })

  it('retries worklet initialization only after a rejected module load is cleaned up', async () => {
    let attempts = 0
    class FlakyContext extends FakeContext {
      audioWorklet = {
        addModule: vi.fn(async () => {
          attempts++
          if (attempts === 1) throw new Error('module load failed')
          return undefined
        }),
      }
    }
    vi.stubGlobal('AudioContext', FlakyContext)
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    await expect(player.play()).rejects.toThrow('module load failed')
    await player.play()
    expect(attempts).toBe(2)
    expect(FakeNode.instances).toHaveLength(1)
    player.destroy()
  })

  it('cancels withheld prefill when paused without posting play', async () => {
    FakePort.autoAcknowledge = false
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    const playback = player.play()
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(1))
    player.pause()
    await expect(playback).resolves.toBeUndefined()
    expect(FakeNode.instances[0].port.messages.some(({ message }) => message.type === 'play')).toBe(
      false,
    )
    player.destroy()
  })

  it('shares one source provider while keeping a bounded queue per track', async () => {
    const player = new WorkletAudioPlayer()
    const samples = provider()
    await player.registerAudioSource(SOURCE_ID, samples)
    player.setTracks([track('one'), track('two')])
    await player.play()
    expect(FakeNode.instances).toHaveLength(2)
    for (const node of FakeNode.instances) {
      const pcm = node.port.messages.filter(({ message }) => message.type === 'pcm')
      const queued = pcm.reduce(
        (sum, { message }) => sum + (message.channels as Float32Array[])[0].length,
        0,
      )
      expect(queued).toBe(96_000)
      expect(
        Math.max(...pcm.map(({ message }) => (message.channels as Float32Array[])[0].length)),
      ).toBeLessThanOrEqual(4096)
      expect(node.port.messages.some(({ message }) => message.type === 'play')).toBe(true)
    }
    expect(samples.readFrames).toHaveBeenCalled()
    expect(player.getDiagnostics().maximumReadFrames).toBeLessThanOrEqual(4096)
    player.destroy()
  })

  it('refills from a low watermark back toward the two-second target in useful chunks', async () => {
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    await player.play()
    const node = FakeNode.instances[0]
    const generation = node.port.messages.find(({ message }) => message.type === 'flush')!.message
      .generation as number
    const before = node.port.messages.length
    ;(node.port as FakePort).setQueuedFrames(generation, 71_999)
    node.port.onmessage?.({
      data: { type: 'need-data', generation, queuedFrames: 71_999, acceptedFrames: 96_000 },
    } as MessageEvent)
    await vi.waitFor(() =>
      expect(
        node.port.messages
          .slice(before)
          .filter(({ message }) => message.type === 'pcm')
          .reduce(
            (frames, { message }) => frames + (message.channels as Float32Array[])[0].length,
            0,
          ),
      ).toBe(24_001),
    )
    const firstRefill = node.port.messages
      .slice(before)
      .find(({ message }) => message.type === 'pcm')!.message
    expect((firstRefill.channels as Float32Array[])[0]).toHaveLength(4096)
    player.destroy()
  })

  it('starts replacement queues when tracks change during playback', async () => {
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    await player.play()
    player.setTracks([track('one'), track('two', 1)])
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(3))
    for (const node of FakeNode.instances.slice(1)) {
      expect(node.port.messages.some(({ message }) => message.type === 'play')).toBe(true)
    }
    player.destroy()
  })

  it('applies track-volume changes without rebuilding worklet queues', async () => {
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    const original = track('one')
    player.setTracks([original])
    await player.play()
    const node = FakeNode.instances[0]
    player.setTracks([{ ...original, volume: 0.25 }])
    await Promise.resolve()
    expect(FakeNode.instances).toHaveLength(1)
    expect(node.connect).toHaveBeenCalledTimes(1)
    player.destroy()
  })

  it('rejects caches that are not the 48 kHz processing format', async () => {
    const player = new WorkletAudioPlayer()
    await expect(
      player.registerAudioSource(SOURCE_ID, { ...provider(), sampleRate: 44_100 }),
    ).rejects.toThrow('48000')
  })

  it('rejects an AudioContext that cannot honor the 48 kHz project rate', async () => {
    class WrongRateContext extends FakeContext {
      sampleRate = 44_100
    }
    vi.stubGlobal('AudioContext', WrongRateContext)
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    await expect(player.play()).rejects.toThrow('48000 Hz')
  })

  it('aborts old provider reads and replaces queues on seek', async () => {
    const player = new WorkletAudioPlayer()
    const samples = provider()
    const signals: AbortSignal[] = []
    const originalRead = samples.readFrames
    samples.readFrames = vi.fn((start, count, signal) => {
      signals.push(signal)
      return originalRead(start, count, signal)
    })
    await player.registerAudioSource(SOURCE_ID, samples)
    player.setTracks([track('one')])
    await player.play()
    const oldSignal = signals[0]
    player.seekTo(3)
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(2))
    expect(oldSignal.aborted).toBe(true)
    expect(player.getCurrentTime()).toBe(3)
    player.destroy()
  })

  it('resumes only the newest queue after rapid seeks while playing', async () => {
    const player = new WorkletAudioPlayer()
    await player.registerAudioSource(SOURCE_ID, provider())
    player.setTracks([track('one')])
    await player.play()
    player.seekTo(1)
    player.seekTo(2)
    await vi.waitFor(() => expect(FakeNode.instances).toHaveLength(2))
    const replacement = FakeNode.instances[FakeNode.instances.length - 1]
    await vi.waitFor(() =>
      expect(replacement.port.messages.some(({ message }) => message.type === 'play')).toBe(true),
    )
    expect(player.isPlaying()).toBe(true)
    expect(player.getCurrentTime()).toBe(2)
    player.destroy()
  })

  it('keeps the latest seek playing when it aborts the initial play prefill', async () => {
    const player = new WorkletAudioPlayer()
    const samples = provider()
    let reads = 0
    samples.readFrames = vi.fn((startFrame, frameCount, signal) => {
      reads++
      if (reads === 1) {
        return new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          ),
        )
      }
      return Promise.resolve({
        startFrame,
        frameCount,
        channels: [new Float32Array(frameCount)],
      })
    })
    await player.registerAudioSource(SOURCE_ID, samples)
    player.setTracks([track('one')])
    const initialPlay = player.play()
    await vi.waitFor(() => expect(samples.readFrames).toHaveBeenCalledTimes(1))
    player.seekTo(2)
    await expect(initialPlay).resolves.toBeUndefined()
    await vi.waitFor(() => {
      const latest = FakeNode.instances[FakeNode.instances.length - 1]
      expect(latest.port.messages.some(({ message }) => message.type === 'play')).toBe(true)
    })
    expect(player.isPlaying()).toBe(true)
    expect(player.getCurrentTime()).toBe(2)
    player.destroy()
  })

  it('discards delayed provider work across a rapid seek stress run', async () => {
    const player = new WorkletAudioPlayer()
    const samples = provider()
    await player.registerAudioSource(SOURCE_ID, samples)
    player.setTracks([track('one')])
    await player.play()
    const signals: AbortSignal[] = []
    samples.readFrames = vi.fn(
      (startFrame, frameCount, signal) =>
        new Promise<AudioSampleChunk>((resolve, reject) => {
          signals.push(signal)
          const timer = setTimeout(
            () =>
              resolve({
                startFrame,
                frameCount,
                channels: [new Float32Array(frameCount)],
              }),
            10,
          )
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new DOMException('aborted', 'AbortError'))
            },
            { once: true },
          )
        }),
    )
    player.seekTo(0.25)
    await vi.waitFor(() => expect(samples.readFrames).toHaveBeenCalled())
    for (let time = 2; time <= 10; time++) player.seekTo(time / 4)
    await vi.waitFor(
      () => {
        const latest = FakeNode.instances[FakeNode.instances.length - 1]
        expect(latest.port.messages.some(({ message }) => message.type === 'play')).toBe(true)
      },
      { timeout: 1000 },
    )
    const replacements = FakeNode.instances.slice(1)
    expect(
      replacements
        .slice(0, -1)
        .every((node) => !node.port.messages.some(({ message }) => message.type === 'play')),
    ).toBe(true)
    expect(signals.some((signal) => signal.aborted)).toBe(true)
    expect(player.getCurrentTime()).toBe(2.5)
    expect(player.getDiagnostics().underruns).toBe(0)
    player.destroy()
  })

  it('pads a short EOF provider read with silence to preserve output timing', async () => {
    const player = new WorkletAudioPlayer()
    const samples = provider()
    samples.readFrames = vi.fn(async (startFrame, frameCount) => ({
      startFrame,
      frameCount: Math.floor(frameCount / 2),
      channels: [new Float32Array(Math.floor(frameCount / 2)).fill(0.5)],
    }))
    await player.registerAudioSource(SOURCE_ID, samples)
    player.setTracks([track('one')])
    await player.play()
    const firstPcm = FakeNode.instances[0].port.messages.find(
      ({ message }) => message.type === 'pcm',
    )!.message
    const channel = (firstPcm.channels as Float32Array[])[0]
    expect(channel).toHaveLength(4096)
    expect(channel[0]).toBe(0.5)
    expect(channel[4095]).toBe(0)
    player.destroy()
  })
})
