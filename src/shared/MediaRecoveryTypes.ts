import type { AudioMetadata, AudioSourceId } from './ProjectTypes'

export type MediaRecoveryFailure =
  | 'content-mismatch'
  | 'read-failed'
  | 'write-failed'
  | 'insufficient-space'
  | 'destination-conflict'
export type MediaRecoveryItemState =
  | { status: 'missing' }
  | { status: 'selecting' }
  | { status: 'restoring'; processedBytes: number; totalBytes: number }
  | { status: 'restored' }
  | { status: 'failed'; reason: MediaRecoveryFailure }
export interface MediaRecoverySnapshot {
  recoveryId: string
  revision: number
  projectDisplayName: string
  status: 'active' | 'closed'
  items: Array<{
    audioSourceId: AudioSourceId
    displayName: string
    metadata: AudioMetadata
    byteLength: number
    state: MediaRecoveryItemState
  }>
}
export interface MediaRecoveryRequest {
  recoveryId: string
}
export interface LocateMediaRequest extends MediaRecoveryRequest {
  audioSourceId: AudioSourceId
}
