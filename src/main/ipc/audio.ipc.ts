// ─────────────────────────────────────────────────────────────────────────────
// Audio IPC Handlers
//
// This file is the ONLY place that registers ipcMain.handle() for audio-related
// channels. It is called once from src/main/index.ts during app startup.
//
// Architecture rule:
//   • ipcMain.handle() lives here, not inside AudioEngine modules.
//   • AudioEngine modules (importer.ts, peaks.ts, etc.) are pure functions —
//     they don't know about IPC at all. This makes them unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { probeAudio } from '../audio/importer'
import { generatePeaks } from '../audio/peaks'

// ── Channel: audio:open-file ──────────────────────────────────────────────────
// Opens a native file picker dialog, then probes the chosen file.
// Returns: { filePath: string, metadata: AudioMetadata } | null (if cancelled)
//
// Learning note: dialog.showOpenDialog() must be called from the main process.
// The renderer cannot open native dialogs directly — it must ask main via IPC.
ipcMain.handle('audio:open-file', async (event) => {
  // Get the BrowserWindow that sent this IPC message.
  // We pass it to showOpenDialog so the dialog is modal to that window.
  const win = BrowserWindow.fromWebContents(event.sender)

  const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow()!, {
    title: 'Open Audio File',
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'aac', 'm4a', 'ogg', 'aiff'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })

  // User clicked Cancel
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const filePath = result.filePaths[0]

  // Probe the file for metadata using FFprobe
  const metadata = await probeAudio(filePath)

  return { filePath, metadata }
})

// ── Channel: audio:probe-file ─────────────────────────────────────────────────
// Probes a file without opening a dialog — used when reopening a project file
// where the audio path is already known.
ipcMain.handle('audio:probe-file', async (_event, filePath: string) => {
  return probeAudio(filePath)
})

// ── Channel: audio:generate-peaks ────────────────────────────────────────────
// Generates (or loads from cache) waveform peaks for a given audio file.
// Pushes progress events to the renderer on 'audio:peaks-progress'.
//
// Learning note: we use event.sender.send() to push progress events back to
// the specific renderer window that requested the operation. This is the
// one-way push pattern (main → renderer), separate from the invoke/handle
// request-response pattern.
ipcMain.handle('audio:generate-peaks', async (event, filePath: string) => {
  // First probe the file to get its duration (needed for progress estimation)
  const metadata = await probeAudio(filePath)

  const peaks = await generatePeaks(
    filePath,
    metadata.durationSeconds,
    (progress) => {
      // Push progress to the renderer — the renderer subscribed via
      // window.electronAPI.on.peaksProgress() in the useEffect
      if (!event.sender.isDestroyed()) {
        event.sender.send('audio:peaks-progress', progress)
      }
    },
  )

  return peaks
})

// ── Learning note on ipcMain.handle ──────────────────────────────────────────
// ipcMain.handle(channel, handler) registers a handler for invoke() calls.
//   • The handler receives (event, ...args) — event.sender is the WebContents
//   • Return value is automatically serialised and sent back to the renderer
//   • Throwing an Error causes the renderer's Promise to reject
//   • Each channel can only have ONE handler (unlike .on which allows many)
