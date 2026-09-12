import { describe, expect, it } from 'vitest'
import { WORKLET_CODE } from './AudioPlayerWorklet'

interface WorkletPort {
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null
  messages: Record<string, unknown>[]
  postMessage(message: Record<string, unknown>): void
}

function createProcessor(maxFrames = 8, targetFrames = 4, refillFrames = targetFrames) {
  let Processor: new (options: unknown) => {
    port: WorkletPort
    process(inputs: unknown[], outputs: Float32Array[][]): boolean
  }
  class HostProcessor {
    port: WorkletPort = {
      onmessage: null,
      messages: [],
      postMessage(message) {
        this.messages.push(message)
      },
    }
  }
  const registerProcessor = (_name: string, constructor: typeof Processor) => {
    Processor = constructor
  }
  Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    WORKLET_CODE,
  )(HostProcessor, registerProcessor)
  return new Processor!({ processorOptions: { maxFrames, targetFrames, refillFrames } })
}

function send(processor: ReturnType<typeof createProcessor>, data: Record<string, unknown>) {
  processor.port.onmessage?.({ data })
}

describe('RiffCut AudioWorklet queue', () => {
  it('applies gain, maps mono to every output channel, and reports acknowledged depth', () => {
    const processor = createProcessor()
    send(processor, { type: 'flush', generation: 2 })
    send(processor, {
      type: 'pcm',
      generation: 2,
      channels: [new Float32Array([1, -1, 0.5, -0.5])],
      gain: 0.5,
    })
    send(processor, { type: 'play', startId: 1 })
    const output = [[new Float32Array(4), new Float32Array(4)]]
    expect(processor.process([], output)).toBe(true)
    expect([...output[0][0]]).toEqual([0.5, -0.5, 0.25, -0.25])
    expect([...output[0][1]]).toEqual([0.5, -0.5, 0.25, -0.25])
    expect(processor.port.messages).toContainEqual({
      type: 'depth',
      generation: 2,
      queuedFrames: 4,
      acceptedFrames: 4,
    })
    expect(processor.port.messages).toContainEqual({ type: 'started', generation: 2, startId: 1 })
  })

  it('rejects overflow and ignores stale generations after a flush', () => {
    const processor = createProcessor(4, 2)
    send(processor, { type: 'flush', generation: 3 })
    send(processor, { type: 'pcm', generation: 2, channels: [new Float32Array(4)], gain: 1 })
    send(processor, { type: 'pcm', generation: 3, channels: [new Float32Array(5)], gain: 1 })
    expect(processor.port.messages).toContainEqual({ type: 'overflow', generation: 3 })
    expect(processor.port.messages).not.toContainEqual({
      type: 'depth',
      generation: 3,
      queuedFrames: 4,
    })
  })

  it('requests a refill once until more PCM is acknowledged', () => {
    const processor = createProcessor(8, 4)
    send(processor, { type: 'flush', generation: 1 })
    const output = [[new Float32Array(2)]]
    processor.process([], output)
    processor.process([], output)
    expect(processor.port.messages.filter((message) => message.type === 'need-data')).toHaveLength(
      1,
    )
    send(processor, { type: 'pcm', generation: 1, channels: [new Float32Array(2)], gain: 1 })
    processor.process([], output)
    expect(processor.port.messages.filter((message) => message.type === 'need-data')).toHaveLength(
      2,
    )
  })

  it('waits for the low watermark before requesting a refill toward the target', () => {
    const processor = createProcessor(8, 6, 2)
    send(processor, { type: 'flush', generation: 1 })
    send(processor, { type: 'pcm', generation: 1, channels: [new Float32Array(6)], gain: 1 })
    send(processor, { type: 'play', startId: 1 })
    processor.process([], [[new Float32Array(2)]])
    expect(processor.port.messages.filter((message) => message.type === 'need-data')).toHaveLength(
      0,
    )
    processor.process([], [[new Float32Array(3)]])
    expect(processor.port.messages).toContainEqual({
      type: 'need-data',
      generation: 1,
      queuedFrames: 1,
    })
  })

  it('sustains playback without underruns when the host refills at the low watermark', () => {
    const processor = createProcessor(8, 6, 2)
    send(processor, { type: 'flush', generation: 1 })
    send(processor, { type: 'pcm', generation: 1, channels: [new Float32Array(6)], gain: 1 })
    send(processor, { type: 'play', startId: 1 })
    let handledRequests = 0
    for (let quantum = 0; quantum < 100; quantum++) {
      processor.process([], [[new Float32Array(1)]])
      const requests = processor.port.messages.filter((message) => message.type === 'need-data')
      while (handledRequests < requests.length) {
        send(processor, {
          type: 'pcm',
          generation: 1,
          channels: [new Float32Array(5)],
          gain: 1,
        })
        handledRequests++
      }
    }
    expect(processor.port.messages.filter((message) => message.type === 'underrun')).toEqual([])
    expect(handledRequests).toBeGreaterThan(10)
  })

  it('reports a fresh start anchor after pause and resume', () => {
    const processor = createProcessor(16, 4)
    send(processor, { type: 'flush', generation: 1 })
    send(processor, {
      type: 'pcm',
      generation: 1,
      channels: [new Float32Array(8)],
      gain: 1,
    })
    send(processor, { type: 'play', startId: 1 })
    processor.process([], [[new Float32Array(2)]])
    send(processor, { type: 'pause' })
    send(processor, { type: 'play', startId: 2 })
    processor.process([], [[new Float32Array(2)]])
    expect(
      processor.port.messages
        .filter((message) => message.type === 'started')
        .map((message) => message.startId),
    ).toEqual([1, 2])
  })
})
