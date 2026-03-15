// ─────────────────────────────────────────────────────────────────────────────
// useKeyboardShortcuts
//
// Registers document-level keydown listeners for all editor shortcuts.
// Must be mounted once at the App level.
//
// Shortcuts:
//   Space                  — Play / Pause
//   M                      — Mute selected region (waveform drag-selection)
//   U                      — Unmute: remove edit region at selection / selectedEditId
//   Delete / Backspace     — If edit region selected: remove it + unmute words
//                            If drag-selection active: add mute edit
//   Escape                 — Clear selection + deselect edit region
//   ← / →                  — Nudge playhead ±1 s
//   Shift+← / Shift+→      — Nudge playhead ±5 s
//   Cmd+S / Ctrl+S         — Save project (handled in App via callback)
//   Cmd+Z / Ctrl+Z         — Undo last mute edit (removes edit + un-mutes words)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { useEditorStore } from '../stores/editor.store'
import { getWaveSurferInstance } from '../components/Waveform/WaveformView'

interface Options {
  /** Called when Cmd+S / Ctrl+S is pressed. */
  onSave?: () => void
}

export function useKeyboardShortcuts({ onSave }: Options = {}) {
  const addEdit             = useEditorStore((s) => s.addEdit)
  const removeEditWithUndo  = useEditorStore((s) => s.removeEditWithUndo)
  const edits               = useEditorStore((s) => s.edits)
  const selection           = useEditorStore((s) => s.selection)
  const setSelection        = useEditorStore((s) => s.setSelection)

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement

      // Don't intercept while typing in an actual input field
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return

      const isMeta = e.metaKey || e.ctrlKey
      const ws = getWaveSurferInstance()

      // ── Cmd+S — Save ────────────────────────────────────────────────────
      if (isMeta && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault()
        onSave?.()
        return
      }

      // ── Cmd+Z — Undo last mute edit ──────────────────────────────────────
      if (isMeta && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault()
        useEditorStore.getState().undo()
        return
      }

      // Don't handle other shortcuts if a modifier is held (avoids conflicting
      // with OS or DevTools shortcuts like Cmd+R, Cmd+Option+I, etc.)
      if (isMeta) return

      switch (e.code) {
        // ── Space — Play / Pause ───────────────────────────────────────────
        case 'Space': {
          e.preventDefault()
          if (!ws) break
          // Preview Mode: if playhead is inside a muted region, skip to its end
          const isCurrentlyPlaying = ws.isPlaying()
          if (!isCurrentlyPlaying) {
            const { previewMode, edits: currentEdits } = useEditorStore.getState()
            if (previewMode) {
              const currentTime = ws.getCurrentTime()
              const muted = currentEdits.filter((edit) => edit.type === 'mute')
              const inside = muted.find(
                (edit) => currentTime >= edit.start && currentTime < edit.end,
              )
              if (inside) ws.setTime(inside.end)
            }
          }
          ws.playPause()
          break
        }

        // ── M — Mute selected region ───────────────────────────────────────
        case 'KeyM': {
          if (!selection) break
          e.preventDefault()
          addEdit({ type: 'mute', start: selection.start, end: selection.end, source: 'manual' })
          setSelection(null)
          break
        }

        // ── U — Unmute ─────────────────────────────────────────────────────
        // If an edit region is selected on the waveform, remove it.
        // Otherwise remove any mute edits overlapping the drag-selection.
        case 'KeyU': {
          e.preventDefault()
          const { selectedEditId } = useEditorStore.getState()
          if (selectedEditId) {
            removeEditWithUndo(selectedEditId)
            break
          }
          if (!selection) break
          const overlapping = edits.filter(
            (edit) =>
              edit.type === 'mute' &&
              edit.start < selection.end &&
              edit.end > selection.start,
          )
          overlapping.forEach((edit) => removeEditWithUndo(edit.id))
          setSelection(null)
          break
        }

        // ── Delete / Backspace ─────────────────────────────────────────────
        // If an edit region is selected: remove it + un-mute its words.
        // If a drag-selection is active: add a mute edit.
        case 'Delete':
        case 'Backspace': {
          const { selectedEditId } = useEditorStore.getState()
          if (selectedEditId) {
            e.preventDefault()
            removeEditWithUndo(selectedEditId)
            break
          }
          if (!selection) break
          e.preventDefault()
          addEdit({ type: 'mute', start: selection.start, end: selection.end, source: 'manual' })
          setSelection(null)
          break
        }

        // ── Escape — Clear selection + deselect edit region ───────────────
        case 'Escape': {
          e.preventDefault()
          setSelection(null)
          useEditorStore.getState().setSelectedEditId(null)
          break
        }

        // ── Arrow keys — Nudge playhead ────────────────────────────────────
        case 'ArrowLeft': {
          if (!ws) break
          e.preventDefault()
          const amount = e.shiftKey ? 5 : 1
          ws.setTime(Math.max(0, ws.getCurrentTime() - amount))
          break
        }

        case 'ArrowRight': {
          if (!ws) break
          e.preventDefault()
          const amount = e.shiftKey ? 5 : 1
          ws.setTime(Math.min(ws.getDuration(), ws.getCurrentTime() + amount))
          break
        }

        default:
          break
      }
    }

    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [selection, edits, addEdit, removeEditWithUndo, setSelection, onSave])
}
