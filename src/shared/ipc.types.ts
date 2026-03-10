// ─────────────────────────────────────────────────────────────────────────────
// IPC Contract
//
// This is the typed interface between the renderer (React) and the main process
// (Node.js). It is exposed on window.electronAPI via contextBridge in the
// preload script.
//
// Rules:
//   • Every method here has a corresponding ipcMain.handle() in src/main/ipc/
//   • The preload script must implement this interface with `satisfies IElectronAPI`
//   • Only plain, serialisable values cross the IPC boundary (no class instances,
//     no functions as arguments — Promises are fine as return values)
// ─────────────────────────────────────────────────────────────────────────────

import type { AudioMetadata, PeakData, ProjectFile } from './project.types'

export interface IElectronAPI {
  audio: {
    /**
     * Opens a native file dialog filtered to audio files.
     * Returns the chosen file path and its FFprobe metadata.
     * Returns null if the user cancelled the dialog.
     */
    openFile(): Promise<{ filePath: string; metadata: AudioMetadata } | null>

    /**
     * Generates waveform peak data for the given audio file path.
     * The result is cached as <basename>.peaks.json alongside the audio file.
     * Emits progress events on the 'audio:peaks-progress' channel.
     */
    generatePeaks(filePath: string): Promise<PeakData>
  }

  project: {
    /** Parses and validates a .podcut.json file from disk. */
    open(filePath: string): Promise<ProjectFile>

    /** Serialises and writes a ProjectFile to disk. */
    save(project: ProjectFile, filePath: string): Promise<void>

    /**
     * Opens a Save As dialog, then writes the file.
     * Returns the chosen path so the renderer can update its state.
     */
    saveAs(project: ProjectFile): Promise<string | null>
  }

  // ── Push-event subscriptions ─────────────────────────────────────────────
  // These are one-way: main → renderer. The renderer subscribes, and receives
  // events as they fire. The return value is a cleanup function (call it to
  // unsubscribe), suitable for use in a React useEffect cleanup.

  on: {
    /** Fired periodically during peak generation. progress is 0–1. */
    peaksProgress(callback: (progress: number) => void): () => void
  }
}

// ── Global type augmentation ──────────────────────────────────────────────────
// Declare window.electronAPI on the global Window type so TypeScript
// recognises it everywhere in the renderer without an explicit cast.
declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
