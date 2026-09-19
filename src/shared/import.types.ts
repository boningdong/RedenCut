import type { AudioSource, AudioSourceId, ProjectFile } from './ProjectTypes'

export type ImportMode = 'copy' | 'reference'
export type ImportJobState = 'preparing' | 'committing' | 'committed' | 'cancelled' | 'failed'
export type ImportCancellationResult = 'cancelled' | 'commit-won' | 'not-found'
type ImportStage =
  'selected' | 'validating' | 'copying' | 'referencing' | 'building-cache' | 'publishing' | 'ready'

export interface ImportSelection {
  token: string
  displayName: string
}

export interface ImportProgress {
  importId: string
  displayName: string
  stage: ImportStage
  percent: number
}

export interface WaveformLevelDescriptor {
  samplesPerBucket: 256 | 4096 | 65536
  bucketCount: number
}

export interface AudioSourceCacheDescriptor {
  audioSourceId: AudioSourceId
  sampleRate: number
  channels: number
  frameCount: number
  waveformLevels: WaveformLevelDescriptor[]
}

export interface ImportResult<CommitValue = void> {
  project: ProjectFile
  source: AudioSource
  cache: AudioSourceCacheDescriptor
  value: CommitValue
}

export interface WorkspaceDescriptor {
  kind: 'temporary' | 'saved'
  displayName: string
  portable: boolean
}
