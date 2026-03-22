// ─────────────────────────────────────────────────────────────────────────────
// Preload Script — IPC Bridge
//
// Runs in a privileged context before the renderer. Its ONLY job is to
// forward typed calls between window.electronAPI (renderer) and ipcMain (main).
//
// Security:
//   • contextBridge.exposeInMainWorld isolates renderer from Node.js APIs
//   • The renderer cannot import electron or call ipcRenderer directly
//   • This file is the entire attack surface between untrusted web content
//     and the privileged main process — keep it minimal and auditable
// ─────────────────────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { IElectronAPI } from '../shared/ipc.types'

// ── The API object ────────────────────────────────────────────────────────────
// `satisfies IElectronAPI` gives a compile-time check that this object
// fully implements the interface declared in ipc.types.ts. If you add a
// method to IElectronAPI and forget to implement it here, TypeScript errors.
const api = {
  audio: {
    openFile: () =>
      ipcRenderer.invoke('audio:open-file'),

    probeFile: (filePath: string) =>
      ipcRenderer.invoke('audio:probe-file', filePath),

    generatePeaks: (filePath: string) =>
      ipcRenderer.invoke('audio:generate-peaks', filePath),
  },

  project: {
    openDialog: () =>
      ipcRenderer.invoke('project:open-dialog'),

    save: (project: unknown, filePath: string) =>
      ipcRenderer.invoke('project:save', project, filePath),

    saveAs: (project: unknown) =>
      ipcRenderer.invoke('project:save-as', project),
  },

  transcript: {
    checkAvailability: () =>
      ipcRenderer.invoke('transcript:check-availability'),

    generate: (filePath: string, language?: string) =>
      ipcRenderer.invoke('transcript:generate', filePath, language),
  },

  render: {
    export: (project: unknown, outputPath: string) =>
      ipcRenderer.invoke('project:export', project, outputPath),
  },

  // ── Push event subscriptions ───────────────────────────────────────────────
  on: {
    peaksProgress: (callback: (progress: number) => void) => {
      const handler = (_event: IpcRendererEvent, progress: number) => callback(progress)
      ipcRenderer.on('audio:peaks-progress', handler)
      return () => ipcRenderer.off('audio:peaks-progress', handler)
    },

    transcriptProgress: (callback: (status: string) => void) => {
      const handler = (_event: IpcRendererEvent, status: string) => callback(status)
      ipcRenderer.on('transcript:progress', handler)
      return () => ipcRenderer.off('transcript:progress', handler)
    },

    renderProgress: (callback: (p: import('../shared/ipc.types').RenderProgress) => void) => {
      const handler = (_event: IpcRendererEvent, p: import('../shared/ipc.types').RenderProgress) => callback(p)
      ipcRenderer.on('render:progress', handler)
      return () => ipcRenderer.off('render:progress', handler)
    },
  },
} satisfies IElectronAPI

// Expose to the renderer as window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', api)
