export type DevelopmentCheck = 'ffmpeg' | 'ffprobe' | 'whisper' | 'uv' | 'python' | 'libraries'
export interface DevelopmentEnvironment {
  checking?: DevelopmentCheck[]
  platform: string
  ffmpeg: boolean
  ffprobe: boolean
  whisper: boolean
  uv: boolean
  python: boolean
  libraries: boolean
  ready: boolean
}
