export interface PcmQueueMessage {
  type: 'pcm'
  generation: number
  channels: Float32Array[]
  gain: number
}

export function sendPcmChunk(port: MessagePort, message: PcmQueueMessage): void {
  port.postMessage(
    message,
    message.channels.map((channel) => channel.buffer),
  )
}

export const WORKLET_CODE = /* javascript */ `
class RedenCutPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.queue = []
    this.queuedFrames = 0
    this.acceptedFrames = 0
    this.generation = 0
    this.playing = false
    this.started = false
    this.startId = 0
    this.ended = false
    this.maxFrames = options.processorOptions.maxFrames
    this.targetFrames = options.processorOptions.targetFrames
    this.refillFrames = options.processorOptions.refillFrames ?? this.targetFrames
    this.requestOutstanding = false
    this.port.onmessage = ({ data }) => {
      if (data.type === 'pcm') {
        if (data.generation !== this.generation) return
        const frames = data.channels[0]?.length ?? 0
        if (this.queuedFrames + frames > this.maxFrames) {
          this.port.postMessage({ type: 'overflow', generation: this.generation })
          return
        }
        this.queue.push({ channels: data.channels, gain: data.gain, offset: 0 })
        this.queuedFrames += frames
        this.acceptedFrames += frames
        this.requestOutstanding = false
        this.port.postMessage({
          type: 'depth',
          generation: this.generation,
          queuedFrames: this.queuedFrames,
          acceptedFrames: this.acceptedFrames,
        })
      } else if (data.type === 'flush') {
        this.queue = []
        this.queuedFrames = 0
        this.acceptedFrames = 0
        this.generation = data.generation
        this.started = false
        this.ended = false
        this.requestOutstanding = false
      } else if (data.type === 'play') {
        this.startId = data.startId
        this.playing = true
        this.started = false
      } else if (data.type === 'pause') {
        this.playing = false
      } else if (data.type === 'end' && data.generation === this.generation) {
        this.ended = true
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    const blockSize = output[0]?.length ?? 128
    let filled = 0
    if (this.playing) {
      while (filled < blockSize && this.queue.length > 0) {
        const chunk = this.queue[0]
        const count = Math.min(blockSize - filled, chunk.channels[0].length - chunk.offset)
        for (let channel = 0; channel < output.length; channel++) {
          const source = chunk.channels[Math.min(channel, chunk.channels.length - 1)]
          for (let index = 0; index < count; index++) {
            output[channel][filled + index] = source[chunk.offset + index] * chunk.gain
          }
        }
        chunk.offset += count
        filled += count
        this.queuedFrames -= count
        if (chunk.offset === chunk.channels[0].length) this.queue.shift()
      }
      if (filled > 0 && !this.started) {
        this.started = true
        this.port.postMessage({ type: 'started', generation: this.generation, startId: this.startId })
      }
      if (filled < blockSize && !this.ended) {
        this.port.postMessage({ type: 'underrun', generation: this.generation })
      }
    }
    for (let channel = 0; channel < output.length; channel++) output[channel].fill(0, filled)
    if (this.queuedFrames < this.refillFrames && !this.ended && !this.requestOutstanding) {
      this.requestOutstanding = true
      this.port.postMessage({ type: 'need-data', generation: this.generation, queuedFrames: this.queuedFrames })
    }
    return true
  }
}
registerProcessor('redencut-player', RedenCutPlayerProcessor)
`
