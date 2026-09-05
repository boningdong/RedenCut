import type { HarnessWindowMode } from '../../src/shared/harnessWindowMode'

export interface GenerationIdentity {
  runId: string
  generation: number
}

export interface RuntimeStatus {
  state: 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'
  generation: number
  stage: string
  runId?: string
  runDirectory?: string
  pid?: number
  error?: string
  windowMode?: HarnessWindowMode
}

export interface RuntimeOptions {
  windowMode?: HarnessWindowMode
  repositoryRoot: string
  outputRoot: string
  startupTimeoutMs?: number
  readinessTimeoutMs?: number
  applicationEntry?: string
  uiTimeoutMs?: number
  shutdownTimeoutMs?: number
}

export interface ApplicationDiagnostics {
  main: {
    pid: number
    userData: string
    temporary: string
    sessionData: string
    hasSingleInstanceLock: boolean
  }
  renderer: { ready: boolean; dirty: boolean; busy: boolean; title: string }
}
