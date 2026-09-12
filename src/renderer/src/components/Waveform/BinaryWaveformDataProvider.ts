import type { AudioSourceCacheDescriptor, WaveformLevelDescriptor } from '@shared/import.types'
import type {
  WaveformBucket,
  WaveformBucketRange,
  WaveformDataProvider,
  WaveformRangeRequest,
} from './WaveformDataProvider'

export class BinaryWaveformDataProvider implements WaveformDataProvider {
  constructor(private readonly descriptor: AudioSourceCacheDescriptor) {}

  async readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange> {
    if (request.signal.aborted) throw new DOMException('Waveform request aborted', 'AbortError')
    const startFrame = Math.max(
      0,
      Math.floor(request.sourceStartSeconds * this.descriptor.sampleRate),
    )
    const endFrame = Math.min(
      this.descriptor.frameCount,
      Math.ceil(request.sourceEndSeconds * this.descriptor.sampleRate),
    )
    const width = Math.max(1, Math.floor(request.targetPixelWidth))
    if (endFrame <= startFrame) return { buckets: [] }
    const level = this.chooseLevel((endFrame - startFrame) / width)
    const startBucket = Math.floor(startFrame / level.samplesPerBucket)
    const endBucket = Math.min(level.bucketCount, Math.ceil(endFrame / level.samplesPerBucket))
    const bucketCount = Math.max(0, endBucket - startBucket)
    if (bucketCount === 0) return { buckets: [] }
    const response = await fetch(
      `riffcut://cache/${this.descriptor.audioSourceId}/waveform/${level.samplesPerBucket}`,
      {
        headers: { Range: `bytes=${startBucket * 8}-${endBucket * 8 - 1}` },
        signal: request.signal,
      },
    )
    if (response.status !== 206) throw new Error('Waveform resource did not return a bounded range')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== bucketCount * 8) throw new Error('Incomplete waveform bucket range')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const decoded = Array.from({ length: bucketCount }, (_, index) => ({
      min: view.getFloat32(index * 8, true),
      max: view.getFloat32(index * 8 + 4, true),
    }))
    return { buckets: decoded.length <= width ? decoded : aggregate(decoded, width) }
  }

  private chooseLevel(samplesPerPixel: number): WaveformLevelDescriptor {
    const levels = [...this.descriptor.waveformLevels].sort(
      (left, right) => left.samplesPerBucket - right.samplesPerBucket,
    )
    return (
      [...levels].reverse().find((level) => level.samplesPerBucket <= samplesPerPixel) ?? levels[0]
    )
  }
}

function aggregate(input: WaveformBucket[], width: number): WaveformBucket[] {
  return Array.from({ length: width }, (_, outputIndex) => {
    const start = Math.floor((outputIndex * input.length) / width)
    const end = Math.ceil(((outputIndex + 1) * input.length) / width)
    let min = 1
    let max = -1
    for (let index = start; index < end; index++) {
      min = Math.min(min, input[index].min)
      max = Math.max(max, input[index].max)
    }
    return { min, max }
  })
}
