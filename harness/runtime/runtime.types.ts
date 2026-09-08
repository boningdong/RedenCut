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
}

export interface RuntimeOptions {
  repositoryRoot: string
  outputRoot: string
  startupTimeoutMs?: number
  readinessTimeoutMs?: number
  applicationEntry?: string
  uiTimeoutMs?: number
  shutdownTimeoutMs?: number
}

export interface ApplicationDiagnostics {
  dialogs?: Array<{ at: string; state: string; purpose: string; error?: string }>
  main: {
    pid: number
    userData: string
    temporary: string
    sessionData: string
    hasSingleInstanceLock: boolean
  }
  renderer: {
    ready: boolean
    dirty: boolean
    busy: boolean
    title: string
    tracks?: Array<{
      id: string
      name: string
      clips: Array<{
        id: string
        audioSourceId: string
        sourceStart: number
        sourceEnd: number
        waveformReady: boolean
      }>
    }>
  }
}
