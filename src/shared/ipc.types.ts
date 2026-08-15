import type {
  ImportMode,
  ImportProgress,
  ImportResult,
  ImportSelection,
  ProjectOpenResult,
  WorkspaceDescriptor,
} from './import.types'
import type { AudioSourceId, ProjectFile, Transcript } from './project.types'

export interface RenderProgress {
  percent: number
  currentSeconds: number
  totalSeconds: number
}

export interface IElectronAPI {
  audio: {
    selectImportFile(): Promise<ImportSelection | null>
    startImport(
      importId: string,
      selectionToken: string,
      mode: ImportMode,
      project: ProjectFile,
    ): Promise<ImportResult>
    cancelImport(importId: string): Promise<void>
  }
  project: {
    initialize(): Promise<ProjectOpenResult>
    openDialog(): Promise<ProjectOpenResult | null>
    save(project: ProjectFile): Promise<WorkspaceDescriptor | null>
    saveAs(project: ProjectFile): Promise<WorkspaceDescriptor | null>
  }
  transcript: {
    checkAvailability(): Promise<string | null>
    generate(audioSourceId: AudioSourceId, language?: string): Promise<Transcript>
  }
  render: {
    export(project: ProjectFile, format: ProjectFile['export']['format']): Promise<boolean>
  }
  on: {
    importProgress(callback: (progress: ImportProgress) => void): () => void
    transcriptProgress(callback: (status: string) => void): () => void
    renderProgress(callback: (progress: RenderProgress) => void): () => void
  }
}

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
