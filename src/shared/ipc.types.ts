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

import type { AudioMetadata, PeakData, ProjectFile, Transcript } from './project.types'

export interface IElectronAPI {
  audio: {
    /**
     * Opens a native file dialog filtered to audio files.
     * Returns the chosen file path and its FFprobe metadata.
     * Returns null if the user cancelled the dialog.
     */
    openFile(): Promise<{ filePath: string; metadata: AudioMetadata } | null>

    /**
     * Probes an audio file without opening a dialog.
     * Used when reopening an audio file from a saved project.
     */
    probeFile(filePath: string): Promise<AudioMetadata>

    /**
     * Generates waveform peak data for the given audio file path.
     * The result is cached as <basename>.peaks.json alongside the audio file.
     * Emits progress events on the 'audio:peaks-progress' channel.
     */
    generatePeaks(filePath: string): Promise<PeakData>
  }

  project: {
    /**
     * Opens a native file dialog filtered to .podcut files, parses and
     * validates the project JSON, then returns the project + its file path.
     * Returns null if the user cancelled.
     */
    openDialog(): Promise<{ projectPath: string; project: ProjectFile } | null>

    /** Serialises and writes a ProjectFile to the given path. */
    save(project: ProjectFile, filePath: string): Promise<void>

    /**
     * Opens a Save As dialog, then writes the file.
     * Returns the chosen path so the renderer can update its state.
     * Returns null if the user cancelled.
     */
    saveAs(project: ProjectFile): Promise<string | null>
  }

  transcript: {
    /**
     * Checks whether the local Whisper.cpp binary and a model are available.
     * Returns null if ready, or an actionable error string if not.
     */
    checkAvailability(): Promise<string | null>

    /**
     * Transcribes the given audio file using whisper.cpp.
     * Returns word-level timestamps. May take minutes for long files.
     * Emits progress events on the 'transcript:progress' channel.
     */
    generate(filePath: string, language?: string): Promise<Transcript>
  }

  // ── Push-event subscriptions ─────────────────────────────────────────────
  // These are one-way: main → renderer. The renderer subscribes, and receives
  // events as they fire. The return value is a cleanup function (call it to
  // unsubscribe), suitable for use in a React useEffect cleanup.

  on: {
    /** Fired periodically during peak generation. progress is 0–1. */
    peaksProgress(callback: (progress: number) => void): () => void

    /**
     * Fired during transcription with a status string, e.g. "Processing segment 4/12".
     * The renderer can display this as a progress label.
     */
    transcriptProgress(callback: (status: string) => void): () => void
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
