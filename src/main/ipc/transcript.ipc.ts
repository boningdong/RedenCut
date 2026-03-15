// ─────────────────────────────────────────────────────────────────────────────
// Transcript IPC Handlers
// ─────────────────────────────────────────────────────────────────────────────

import { ipcMain } from 'electron'
import { whisperTranscriber } from '../transcriber/whisper'

// ── Channel: transcript:check-availability ────────────────────────────────────
// Returns null if whisper is ready, or an actionable error string if not.
ipcMain.handle('transcript:check-availability', async () => {
  return whisperTranscriber.unavailableReason()
})

// ── Channel: transcript:generate ─────────────────────────────────────────────
// Transcribes the given audio file using whisper.cpp.
// Pushes progress status strings on the 'transcript:progress' channel.
ipcMain.handle('transcript:generate', async (event, filePath: string, language?: string) => {
  return whisperTranscriber.transcribe(
    filePath,
    { language },
    (status) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('transcript:progress', status)
      }
    },
  )
})
