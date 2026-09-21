import { z } from 'zod'
import type { DevelopmentEnvironment } from './developmentEnvironment.types'
export type ResourceCapability = 'transcription' | 'alignment' | 'diarization'
type ResourceStatus = 'missing' | 'downloading' | 'verifying' | 'paused' | 'ready' | 'failed'
export interface ResourceState {
  id: string
  source?: 'development-runtime' | 'bundled'
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
  selectedWhisperModelId?: string
  whisperModels?: Array<{
    id: string
    variant: 'small' | 'medium' | 'large-v3'
    recommended: boolean
  }>
  baseReady: boolean
}
export const ResourcePreparationSchema = z.union([
  z.enum(['base', 'alignment', 'diarization']),
  z.object({ kind: z.literal('model'), modelId: z.string().min(1) }).strict(),
])
export type ResourcePreparation = z.infer<typeof ResourcePreparationSchema>
