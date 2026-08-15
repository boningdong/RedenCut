import type { PeakData } from '@shared/project.types'
import type {
  WaveformBucket,
  WaveformBucketRange,
  WaveformDataProvider,
  WaveformRangeRequest,
} from './WaveformDataProvider'

interface PeakLevel {
  basePeakSpan: number
  min: Float32Array
  max: Float32Array
}

const LEVEL_FACTOR = 16

function abortError(): Error {
  return Object.assign(new Error('Waveform request aborted'), { name: 'AbortError' })
}

function buildBaseLevel(values: readonly number[]): PeakLevel {
  const min = new Float32Array(values.length)
  const max = new Float32Array(values.length)
  for (let index = 0; index < values.length; index++) {
    const magnitude = Math.max(0, Math.min(1, Math.abs(values[index] ?? 0)))
    min[index] = -magnitude
    max[index] = magnitude
  }
  return { basePeakSpan: 1, min, max }
}

function buildNextLevel(previous: PeakLevel): PeakLevel {
  const length = Math.ceil(previous.min.length / LEVEL_FACTOR)
  const min = new Float32Array(length)
  const max = new Float32Array(length)
  for (let outputIndex = 0; outputIndex < length; outputIndex++) {
    const start = outputIndex * LEVEL_FACTOR
    const end = Math.min(previous.min.length, start + LEVEL_FACTOR)
    let bucketMin = 1
    let bucketMax = -1
    for (let inputIndex = start; inputIndex < end; inputIndex++) {
      bucketMin = Math.min(bucketMin, previous.min[inputIndex])
      bucketMax = Math.max(bucketMax, previous.max[inputIndex])
    }
    min[outputIndex] = bucketMin
    max[outputIndex] = bucketMax
  }
  return { basePeakSpan: previous.basePeakSpan * LEVEL_FACTOR, min, max }
}

export class PeakDataProvider implements WaveformDataProvider {
  private readonly durationSeconds: number
  private readonly basePeakCount: number
  private readonly levels: PeakLevel[]

  constructor(peaks: PeakData) {
    const base = buildBaseLevel(peaks.data[0] ?? [])
    this.durationSeconds = peaks.durationSeconds
    this.basePeakCount = base.min.length
    this.levels = [base]
    while (this.levels[this.levels.length - 1].min.length > 1) {
      this.levels.push(buildNextLevel(this.levels[this.levels.length - 1]))
    }
  }

  async readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange> {
    if (request.signal.aborted) throw abortError()

    const width = Math.max(0, Math.floor(request.targetPixelWidth))
    const buckets: WaveformBucket[] = []
    if (this.durationSeconds <= 0 || this.basePeakCount === 0 || width === 0) return { buckets }

    const startSeconds = Math.max(0, Math.min(this.durationSeconds, request.sourceStartSeconds))
    const endSeconds = Math.max(
      startSeconds,
      Math.min(this.durationSeconds, request.sourceEndSeconds),
    )
    if (endSeconds <= startSeconds) return { buckets }

    const baseStart = Math.floor((startSeconds / this.durationSeconds) * this.basePeakCount)
    const baseEnd = Math.min(
      this.basePeakCount,
      Math.ceil((endSeconds / this.durationSeconds) * this.basePeakCount),
    )
    const available = Math.max(0, baseEnd - baseStart)
    const outputCount = Math.min(width, available)
    for (let outputIndex = 0; outputIndex < outputCount; outputIndex++) {
      if (request.signal.aborted) throw abortError()
      const start = baseStart + Math.floor((outputIndex * available) / outputCount)
      const end = baseStart + Math.ceil(((outputIndex + 1) * available) / outputCount)
      buckets.push(this.aggregateRange(start, end))
    }
    return { buckets }
  }

  private aggregateRange(start: number, end: number): WaveformBucket {
    let min = 1
    let max = -1
    let current = start
    while (current < end) {
      const level = this.findLargestContainedLevel(current, end)
      const levelIndex = current / level.basePeakSpan
      min = Math.min(min, level.min[levelIndex])
      max = Math.max(max, level.max[levelIndex])
      current += level.basePeakSpan
    }
    return { min, max }
  }

  private findLargestContainedLevel(start: number, end: number): PeakLevel {
    for (let index = this.levels.length - 1; index >= 0; index--) {
      const level = this.levels[index]
      if (start % level.basePeakSpan === 0 && start + level.basePeakSpan <= end) {
        return level
      }
    }
    return this.levels[0]
  }
}
