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
  readRange(request: WaveformRangeRequest): Promise<WaveformBucketRange>
}
