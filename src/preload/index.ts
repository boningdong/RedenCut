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

    generatePeaks: (filePath: string) =>
      ipcRenderer.invoke('audio:generate-peaks', filePath),
  },

  project: {
    open: (filePath: string) =>
      ipcRenderer.invoke('project:open', filePath),

    save: (project: unknown, filePath: string) =>
      ipcRenderer.invoke('project:save', project, filePath),

    saveAs: (project: unknown) =>
      ipcRenderer.invoke('project:save-as', project),
  },

  // ── Push event subscriptions ───────────────────────────────────────────────
  // Pattern: register a listener, return a cleanup function.
  // Renderer usage:
  //   useEffect(() => {
  //     return window.electronAPI.on.peaksProgress((p) => setProgress(p))
  //   }, [])
  on: {
    peaksProgress: (callback: (progress: number) => void) => {
      const handler = (_event: IpcRendererEvent, progress: number) => callback(progress)
      ipcRenderer.on('audio:peaks-progress', handler)
      // Return cleanup fn — caller must call this to avoid listener leak
      return () => ipcRenderer.off('audio:peaks-progress', handler)
    },
  },
} satisfies IElectronAPI

// Expose to the renderer as window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', api)

// ── Learning note ─────────────────────────────────────────────────────────────
// ipcRenderer.invoke(channel, ...args) → sends a message to ipcMain.handle()
//   and returns a Promise that resolves with the handler's return value.
//   This is the request/response pattern (renderer asks, main responds).
//
// ipcRenderer.on(channel, handler) → subscribes to one-way events pushed
//   from the main process via webContents.send(). This is the event/push pattern.
//
// Never use ipcRenderer.send/sendSync — they are fire-and-forget with no
// type safety. Always use invoke/handle for request-response.
