import { create } from 'zustand'

/** Pure view state: never saved as audio gain or written into edit history. */
export function fittedWaveformScale(peak: number): number {
  return Number.isFinite(peak) && peak >= 0.0001 ? 0.85 / peak : 1
}
interface WaveformDisplayState {
  workspace: string | null
  scales: Record<string, number>
  gainPreviews: Record<string, number>
  resetWorkspace(workspace: string | null): void
  initialize(trackId: string, peak: number): void
  setScale(trackId: string, scale: number): void
  previewGain(trackId: string, value?: number): void
}
export const useWaveformDisplayStore = create<WaveformDisplayState>()((set) => ({
  workspace: null,
  scales: {},
  gainPreviews: {},
  resetWorkspace: (workspace) => set({ workspace, scales: {}, gainPreviews: {} }),
  initialize: (trackId, peak) =>
    set((state) =>
      state.scales[trackId] !== undefined
        ? state
        : {
            scales: { ...state.scales, [trackId]: fittedWaveformScale(peak) },
          },
    ),
  setScale: (trackId, scale) => set((state) => ({ scales: { ...state.scales, [trackId]: scale } })),
  previewGain: (trackId, value) =>
    set((state) => {
      const gainPreviews = { ...state.gainPreviews }
      if (value === undefined) delete gainPreviews[trackId]
      else gainPreviews[trackId] = value
      return { gainPreviews }
    }),
}))
