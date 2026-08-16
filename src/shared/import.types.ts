import type { AudioSource, AudioSourceId, ProjectFile } from './project.types'

export type ImportMode = 'copy' | 'reference'
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

export interface ImportResult {
  project: ProjectFile
  source: AudioSource
  cache: AudioSourceCacheDescriptor
}

export interface WorkspaceDescriptor {
  kind: 'temporary' | 'saved'
  displayName: string
  portable: boolean
}
