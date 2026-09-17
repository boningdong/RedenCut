import { create } from 'zustand'
import type { Clip } from '@shared/project.types'
import type { WorkspaceToken } from '@shared/session.types'
import { useTimelineStore } from './timeline.store'

export interface TimelineClipboardClip {
  clip: Clip
  sourceTrackId: string
  trackOffset: number
}

export interface TimelineClipboardContents {
  workspaceToken: WorkspaceToken | null
  clips: TimelineClipboardClip[]
  anchorClipId: string
  sourceAnchorTrackId: string
}

interface TimelineClipboardState {
  contents: TimelineClipboardContents | null
  setContents: (contents: TimelineClipboardContents) => void
  clear: () => void
}

export const useTimelineClipboardStore = create<TimelineClipboardState>()((set) => ({
  contents: null,
  setContents: (contents) => set({ contents }),
  clear: () => set({ contents: null }),
}))

let activeProjectGeneration = useTimelineStore.getState().projectGeneration

useTimelineStore.subscribe((state) => {
  if (state.projectGeneration === activeProjectGeneration) return
  activeProjectGeneration = state.projectGeneration
  useTimelineClipboardStore.getState().clear()
})
