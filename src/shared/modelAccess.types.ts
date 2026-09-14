type ModelAccessStatus =
  | 'unchecked'
  | 'checking'
  | 'granted'
  | 'invalid-token'
  | 'access-denied'
  | 'network-error'
  | 'storage-unavailable'
export interface ModelAccessSnapshot {
  status: ModelAccessStatus
  hasToken: boolean
}

export interface LocalModelLoginSnapshot {
  status: 'found' | 'missing' | 'unavailable' | 'unsupported'
}
