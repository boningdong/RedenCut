export interface WaveformRangeRequest {
  sourceStartSeconds: number
  sourceEndSeconds: number
  targetPixelWidth: number
  signal: AbortSignal
}

export interface WaveformBucket {
  min: number
  max: number
}

export interface WaveformBucketRange {
  buckets: WaveformBucket[]
}

export interface WaveformDataProvider {
  /** Absolute peak over the entire original source, independent of the visible range. */
  getPeak?(): Promise<number>
  readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange>
}
