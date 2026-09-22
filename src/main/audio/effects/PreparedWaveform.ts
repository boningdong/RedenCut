import { open } from 'node:fs/promises'
import {
  MAX_PREPARED_WAVEFORM_BUCKETS,
  type PreparedWaveformData,
} from '../../../shared/PreparedAudioTypes'

/** Reuses one bounded buffer; consumers must process each chunk before advancing. */
async function* readPcmFrames(
  path: string,
  channels: number,
  startFrame: number,
  endFrame: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const input = await open(path, 'r')
  const bytes = Buffer.alloc(16384 * channels * 4)
  try {
    for (let start = startFrame; start < endFrame; start += 16384) {
      signal.throwIfAborted()
      const frames = Math.min(16384, endFrame - start)
      const length = frames * channels * 4
      let offset = 0
      while (offset < length) {
        signal.throwIfAborted()
        const { bytesRead } = await input.read(
          bytes,
          offset,
          length - offset,
          start * channels * 4 + offset,
        )
        if (!bytesRead) throw new Error('Prepared PCM ended unexpectedly')
        offset += bytesRead
      }
      yield { start, frames, bytes }
    }
  } finally {
    await input.close()
  }
  signal.throwIfAborted()
}

/** Bounded pyramid: at most 1 MiB per prepared track, independent of recording length. */
export class PreparedWaveform {
  private constructor(
    private readonly path: string,
    private readonly channels: number,
    private readonly signal: AbortSignal,
    private readonly frameCount: number,
    private readonly framesPerBucket: number,
    private readonly levels: Float32Array[],
    private readonly peak: number,
  ) {}

  static async load(
    path: string,
    channels: number,
    frameCount: number,
    signal: AbortSignal,
  ): Promise<PreparedWaveform> {
    const framesPerBucket = Math.max(1, Math.ceil(frameCount / 65536))
    const base = new Float32Array(Math.ceil(frameCount / framesPerBucket) * 2)
    for (let i = 0; i < base.length; i += 2) {
      base[i] = Infinity
      base[i + 1] = -Infinity
    }
    let peak = 0
    for await (const { start, frames, bytes } of readPcmFrames(
      path,
      channels,
      0,
      frameCount,
      signal,
    )) {
      for (let frame = 0; frame < frames; frame++) {
        const bucket = Math.floor((start + frame) / framesPerBucket) * 2
        for (let channel = 0; channel < channels; channel++) {
          const value = bytes.readFloatLE((frame * channels + channel) * 4)
          if (!Number.isFinite(value)) throw new Error('Non-finite prepared PCM')
          base[bucket] = Math.min(base[bucket], value)
          base[bucket + 1] = Math.max(base[bucket + 1], value)
          peak = Math.max(peak, Math.abs(value))
        }
      }
    }
    const levels = [base]
    while (levels.at(-1)!.length > 2) {
      const previous = levels.at(-1)!
      const next = new Float32Array(Math.ceil(previous.length / 4) * 2)
      for (let i = 0; i < next.length; i += 2) {
        next[i] = Math.min(previous[i * 2], previous[i * 2 + 2] ?? Infinity)
        next[i + 1] = Math.max(previous[i * 2 + 1], previous[i * 2 + 3] ?? -Infinity)
      }
      levels.push(next)
    }
    return new PreparedWaveform(path, channels, signal, frameCount, framesPerBucket, levels, peak)
  }

  static validate(
    startFrame: number,
    endFrame: number,
    targetBuckets: number,
    frameCount: number,
  ): void {
    if (
      ![startFrame, endFrame, targetBuckets].every(Number.isSafeInteger) ||
      startFrame < 0 ||
      endFrame <= startFrame ||
      endFrame > frameCount ||
      targetBuckets < 1 ||
      targetBuckets > MAX_PREPARED_WAVEFORM_BUCKETS
    )
      throw new Error('Invalid prepared waveform range')
  }

  async read(
    startFrame: number,
    endFrame: number,
    targetBuckets: number,
  ): Promise<PreparedWaveformData> {
    PreparedWaveform.validate(startFrame, endFrame, targetBuckets, this.frameCount)
    this.signal.throwIfAborted()
    const count = Math.min(targetBuckets, endFrame - startFrame)
    if ((endFrame - startFrame) / count < this.framesPerBucket)
      return this.readExact(startFrame, endFrame, count)
    return this.readOverview(startFrame, endFrame, count)
  }

  private async readExact(
    startFrame: number,
    endFrame: number,
    count: number,
  ): Promise<PreparedWaveformData> {
    const buckets = Array.from({ length: count }, () => ({ min: Infinity, max: -Infinity }))
    let bucketIndex = 0
    for await (const { start, frames, bytes } of readPcmFrames(
      this.path,
      this.channels,
      startFrame,
      endFrame,
      this.signal,
    )) {
      for (let frame = 0; frame < frames; frame++) {
        while (
          bucketIndex + 1 < count &&
          start + frame >=
            startFrame + Math.floor(((bucketIndex + 1) * (endFrame - startFrame)) / count)
        )
          bucketIndex++
        const bucket = buckets[bucketIndex]
        for (let channel = 0; channel < this.channels; channel++) {
          const value = bytes.readFloatLE((frame * this.channels + channel) * 4)
          if (!Number.isFinite(value)) throw new Error('Non-finite prepared PCM')
          bucket.min = Math.min(bucket.min, value)
          bucket.max = Math.max(bucket.max, value)
        }
      }
    }
    return { buckets, peak: this.peak }
  }

  private readOverview(startFrame: number, endFrame: number, count: number): PreparedWaveformData {
    const buckets = Array.from({ length: count }, (_, index) => {
      // Long recordings conservatively include the extrema of intersecting base buckets.
      let first = Math.floor(
        (startFrame + Math.floor((index * (endFrame - startFrame)) / count)) / this.framesPerBucket,
      )
      let end = Math.ceil(
        (startFrame + Math.floor(((index + 1) * (endFrame - startFrame)) / count)) /
          this.framesPerBucket,
      )
      let min = Infinity
      let max = -Infinity
      let level = 0
      while (first < end) {
        if (first % 2 === 1) {
          min = Math.min(min, this.levels[level][first * 2])
          max = Math.max(max, this.levels[level][first * 2 + 1])
          first++
        }
        if (end % 2 === 1) {
          end--
          min = Math.min(min, this.levels[level][end * 2])
          max = Math.max(max, this.levels[level][end * 2 + 1])
        }
        first /= 2
        end /= 2
        level++
      }
      return { min, max }
    })
    return { buckets, peak: this.peak }
  }
}
