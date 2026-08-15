import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer } from 'electron'
import type { IElectronAPI, RenderProgress } from '../shared/ipc.types'
import type { ImportMode, ImportProgress } from '../shared/import.types'
import type { AudioSourceId, ProjectFile } from '../shared/project.types'

const api = {
  audio: {
    selectImportFile: () => ipcRenderer.invoke('audio:select-import-file'),
    startImport: (importId: string, token: string, mode: ImportMode, project: ProjectFile) =>
      ipcRenderer.invoke('audio:start-import', importId, token, mode, project),
    cancelImport: (importId: string) => ipcRenderer.invoke('audio:cancel-import', importId),
  },
  project: {
    initialize: () => ipcRenderer.invoke('project:initialize'),
    openDialog: () => ipcRenderer.invoke('project:open-dialog'),
    save: (project: ProjectFile) => ipcRenderer.invoke('project:save', project),
    saveAs: (project: ProjectFile) => ipcRenderer.invoke('project:save-as', project),
  },
  transcript: {
    checkAvailability: () => ipcRenderer.invoke('transcript:check-availability'),
    generate: (audioSourceId: AudioSourceId, language?: string) =>
      ipcRenderer.invoke('transcript:generate', audioSourceId, language),
  },
  render: {
    export: (project: ProjectFile, format: ProjectFile['export']['format']) =>
      ipcRenderer.invoke('project:export', project, format),
  },
  on: {
    importProgress: (callback: (progress: ImportProgress) => void) => {
      const handler = (_event: IpcRendererEvent, progress: ImportProgress) => callback(progress)
      ipcRenderer.on('audio:import-progress', handler)
      return () => ipcRenderer.off('audio:import-progress', handler)
    },
    transcriptProgress: (callback: (status: string) => void) => {
      const handler = (_event: IpcRendererEvent, status: string) => callback(status)
      ipcRenderer.on('transcript:progress', handler)
      return () => ipcRenderer.off('transcript:progress', handler)
    },
    renderProgress: (callback: (progress: RenderProgress) => void) => {
      const handler = (_event: IpcRendererEvent, progress: RenderProgress) => callback(progress)
      ipcRenderer.on('render:progress', handler)
      return () => ipcRenderer.off('render:progress', handler)
    },
  },
} satisfies IElectronAPI

contextBridge.exposeInMainWorld('electronAPI', api)
