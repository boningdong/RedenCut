import { create } from 'zustand'
import type { MediaRecoverySnapshot } from '@shared/MediaRecoveryTypes'
interface MediaRecoveryState {
  snapshot: MediaRecoverySnapshot | null
  receive(snapshot: MediaRecoverySnapshot): void
}
export const useMediaRecoveryStore = create<MediaRecoveryState>((set, get) => ({
  snapshot: null,
  receive(snapshot) {
    const previous = get().snapshot
    if (previous?.recoveryId === snapshot.recoveryId && previous.revision >= snapshot.revision)
      return
    set({ snapshot })
  },
}))
