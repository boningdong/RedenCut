import { create } from 'zustand'
import type { SpeechProgress } from '@shared/publicMessages'
import type { SpeechBatchProgress, SpeechBatchSummary } from '@shared/speechBatch.types'

interface SpeechBatchState {
  cancelled: boolean
  isGenerating: boolean
  generatingStatus: SpeechProgress | null
  progress: SpeechBatchProgress | null
  summary: SpeechBatchSummary | null
  begin: () => void
  update: (status: SpeechProgress, progress?: SpeechBatchProgress) => void
  finish: (summary?: SpeechBatchSummary) => void
  finishCancelled: () => void
  dismissSummary: () => void
  reset: () => void
}
const initial = {
  cancelled: false,
  isGenerating: false,
  generatingStatus: null,
  progress: null,
  summary: null,
}
export const useSpeechBatchStore = create<SpeechBatchState>()((set) => ({
  ...initial,
  begin: () => set({ ...initial, isGenerating: true }),
  update: (generatingStatus, progress) =>
    set((state) => ({ generatingStatus, progress: progress ?? state.progress })),
  finish: (summary) =>
    set({ isGenerating: false, generatingStatus: null, progress: null, summary: summary ?? null }),
  finishCancelled: () =>
    set({ isGenerating: false, generatingStatus: null, progress: null, cancelled: true }),
  dismissSummary: () => set({ summary: null, cancelled: false }),
  reset: () => set(initial),
}))
