import type { DevelopmentEnvironment } from './developmentEnvironment.types'
export type ResourceCapability = 'transcription' | 'alignment' | 'diarization'
type ResourceStatus = 'missing' | 'downloading' | 'verifying' | 'paused' | 'ready' | 'failed'
export interface ResourceState {
  id: string
  capability: ResourceCapability
  status: ResourceStatus
  downloadedBytes: number
  totalBytes: number | null
  error?: string
}
export interface ResourceSnapshot {
  revision: number
  resources: ResourceState[]
  development?: DevelopmentEnvironment
  baseReady: boolean
}
export type ResourcePreparation = 'base' | 'diarization'
