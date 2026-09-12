import type { AudioSourceCacheDescriptor } from '@shared/import.types'
import type { AudioSampleChunk, AudioSampleProvider } from '@shared/player.types'

export class ContinuousPcmSampleProvider implements AudioSampleProvider {
  readonly format = 'f32-planar' as const
  readonly audioSourceId
  readonly sampleRate
  readonly channels
  readonly frameCount

  constructor(descriptor: AudioSourceCacheDescriptor) {
    this.audioSourceId = descriptor.audioSourceId
    this.sampleRate = descriptor.sampleRate
    this.channels = descriptor.channels
    this.frameCount = descriptor.frameCount
  }

  async readFrames(
    startFrame: number,
    requestedFrameCount: number,
    signal: AbortSignal,
  ): Promise<AudioSampleChunk> {
    if (signal.aborted) throw new DOMException('PCM request aborted', 'AbortError')
    const start = Math.max(0, Math.min(this.frameCount, Math.floor(startFrame)))
    const frameCount = Math.max(
      0,
      Math.min(this.frameCount - start, Math.floor(requestedFrameCount)),
    )
    if (frameCount === 0) return { startFrame: start, frameCount: 0, channels: [] }

    const bytesPerFrame = this.channels * 4
    const startByte = start * bytesPerFrame
    const byteLength = frameCount * bytesPerFrame
    const response = await fetch(`redencut://cache/${this.audioSourceId}/pcm`, {
      headers: { Range: `bytes=${startByte}-${startByte + byteLength - 1}` },
      signal,
    })
    if (response.status !== 206) throw new Error('PCM resource did not return a bounded byte range')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== byteLength)
      throw new Error('PCM resource returned an incomplete frame range')

    const output = Array.from({ length: this.channels }, () => new Float32Array(frameCount))
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < this.channels; channel++) {
        output[channel][frame] = view.getFloat32((frame * this.channels + channel) * 4, true)
      }
    }
    return { startFrame: start, frameCount, channels: output }
  }
}
