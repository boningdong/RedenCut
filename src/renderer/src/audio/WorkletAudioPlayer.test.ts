// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioSampleProvider } from '@shared/player.types'
import type { AudioSourceId, Track } from '@shared/project.types'
import { WorkletAudioPlayer } from './WorkletAudioPlayer'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001' as AudioSourceId

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null
  messages: { message: Record<string, unknown>; transfer?: Transferable[] }[] = []
  postMessage(message: Record<string, unknown>, transfer?: Transferable[]) {
    this.messages.push({ message, transfer })
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
  state = 'running'
  destination = {}
  audioWorklet = { addModule: vi.fn(async () => undefined) }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  }
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
}

function track(id: string, outputStart = 0): Track {
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
        sourceEnd: 5,
        outputStart,
        gain: 1,
        muted: false,
        effects: [],
      },
    ],
  }
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
})
