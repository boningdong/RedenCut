import type { AudioSourceId } from './ProjectTypes'

export type StageProgress = { kind: 'indeterminate' } | { kind: 'determinate'; fraction: number }

export type ProjectOpenStage =
  | 'reading-project'
  | 'waiting-for-media'
  | 'verifying-audio'
  | 'checking-cache'
  | 'building-cache'
  | 'settling-jobs'
  | 'switching-session'

export interface ProjectOpenProgressEvent {
  operationId: string
  sequence: number
  stage: ProjectOpenStage
  projectDisplayName?: string
  source?: {
    audioSourceId: AudioSourceId
    displayName: string
    index: number
    total: number
  }
  progress: StageProgress
}
