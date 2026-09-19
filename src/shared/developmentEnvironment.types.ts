export type DevelopmentCheck = 'ffmpeg' | 'ffprobe' | 'whisper' | 'uv' | 'python' | 'libraries'
export interface DevelopmentEnvironment {
  checking?: DevelopmentCheck[]
  platform: string
  runtimePath?: string
  paths?: Partial<Record<DevelopmentCheck, string>>
  ffmpeg: boolean
  ffprobe: boolean
  whisper: boolean
  uv: boolean
  python: boolean
  libraries: boolean
  ready: boolean
}
