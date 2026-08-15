interface LevelState {
  readonly samplesPerBucket: number
  frames: number
  min: number
  max: number
}

export class PcmWaveformAccumulator {
  private remainder = new Uint8Array(0)
  private readonly states: LevelState[]
  frameCount = 0

  constructor(
    private readonly channels: number,
    levels: readonly number[],
    private readonly emit: (samplesPerBucket: number, bucket: Uint8Array) => void,
  ) {
    if (!Number.isInteger(channels) || channels < 1) throw new Error('channels must be positive')
    this.states = levels.map((samplesPerBucket) => ({
      samplesPerBucket,
      frames: 0,
      min: 1,
      max: -1,
    }))
  }

  push(chunk: Uint8Array): void {
    const bytes = new Uint8Array(this.remainder.byteLength + chunk.byteLength)
    bytes.set(this.remainder)
    bytes.set(chunk, this.remainder.byteLength)

    const bytesPerFrame = this.channels * 4
    const completeBytes = Math.floor(bytes.byteLength / bytesPerFrame) * bytesPerFrame
    const view = new DataView(bytes.buffer, bytes.byteOffset, completeBytes)

    for (let offset = 0; offset < completeBytes; offset += bytesPerFrame) {
      let frameMin = 1
      let frameMax = -1
      for (let channel = 0; channel < this.channels; channel++) {
        const sample = view.getFloat32(offset + channel * 4, true)
        frameMin = Math.min(frameMin, sample)
        frameMax = Math.max(frameMax, sample)
      }
      this.addFrame(frameMin, frameMax)
      this.frameCount++
    }

    this.remainder = bytes.slice(completeBytes)
  }

  finish(): void {
    if (this.remainder.byteLength !== 0) throw new Error('Incomplete PCM frame')
    for (const state of this.states) {
      if (state.frames > 0) this.emitBucket(state)
    }
  }

  private addFrame(min: number, max: number): void {
    for (const state of this.states) {
      state.min = Math.min(state.min, min)
      state.max = Math.max(state.max, max)
      state.frames++
      if (state.frames === state.samplesPerBucket) this.emitBucket(state)
    }
  }

  private emitBucket(state: LevelState): void {
    const bucket = new Uint8Array(8)
    const view = new DataView(bucket.buffer)
    view.setFloat32(0, state.min, true)
    view.setFloat32(4, state.max, true)
    this.emit(state.samplesPerBucket, bucket)
    state.frames = 0
    state.min = 1
    state.max = -1
  }
}
