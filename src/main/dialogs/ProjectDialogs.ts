import type { BrowserWindow } from 'electron'

export interface ProjectDialogs {
  importAudio(window: BrowserWindow, purpose?: 'recovery'): Promise<string | null>
  saveProject(window: BrowserWindow): Promise<string | null>
  openProject(window: BrowserWindow): Promise<string | null>
  dirtyProject(window: BrowserWindow): Promise<'save' | 'discard' | 'cancel'>
  exportAudio(window: BrowserWindow, format: string): Promise<string | null>
}
