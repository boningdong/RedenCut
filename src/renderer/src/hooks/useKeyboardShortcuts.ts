// ─────────────────────────────────────────────────────────────────────────────
// useKeyboardShortcuts
//
// Registers document-level keydown listeners for all editor shortcuts.
// Must be mounted once at the App level.
//
// Shortcuts:
//   Space                  — Play / Pause (via IAudioPlayer)
//   S                      — Split clip at playhead
//   M                      — Mute selected clips or redact a waveform selection
//   U                      — Unmute selected clips or overlapping clips
//   Delete / Backspace     — Remove selected clips/overlay or redact a waveform selection
//   Escape                 — Clear selection + deselect clip
//   ← / →                  — Nudge playhead ±1 s
//   Shift+← / Shift+→     — Nudge playhead ±5 s
//   Cmd+S / Ctrl+S         — Save project
//   Cmd+Z / Ctrl+Z         — Undo last timeline operation
//   Cmd/Ctrl+C/X/V/D       — Audio-focus clip clipboard actions
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { togglePlayback } from '../actions/playbackActions'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'
import { useTranscriptStore } from '../stores/transcript.store'
import {
  splitAtPlayhead,
  muteSelection,
  deleteSelection,
  unmuteSelection,
} from '../actions/timelineActions'
import { copyClips, cutClips, duplicateClips, pasteClips } from '../actions/ClipClipboardActions'
import { getAudioPlayerInstance } from '@shared/player.types'

interface Options {
  /** Called when Cmd+S / Ctrl+S is pressed. */
  onSave?: () => void
}

export function useKeyboardShortcuts({ onSave }: Options = {}) {
  const selection = useEditorStore((s) => s.selection)
  const setSelection = useEditorStore((s) => s.setSelection)

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.isComposing || !(e.target instanceof HTMLElement)) return
      const target = e.target

      // Don't intercept while typing in a real input field.
      // contentEditable (transcript panel) gets a carve-out for Space so the
      // user can play/pause without clicking away from the transcript first.
      const isTypingField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const isContentEditable = target.isContentEditable
      if (isTypingField) return

      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && e.altKey) return
      const player = getAudioPlayerInstance()

      // ── Cmd+S — Save ────────────────────────────────────────────────────
      if (isMeta && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault()
        onSave?.()
        return
      }

      // ── Cmd+Z — Undo last timeline operation ──────────────────────────
      if (isMeta && !e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault()
        void useTimelineStore.getState().undo()
        return
      }

      // ── Cmd+Shift+Z — Redo ────────────────────────────────────────────
      if (isMeta && e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault()
        void useTimelineStore.getState().redo()
        return
      }

      if (
        isMeta &&
        !e.shiftKey &&
        !isContentEditable &&
        target.closest('.audio-panel-view') &&
        useTranscriptStore.getState().selectedTranscriptUnitIds.size === 0
      ) {
        const clipboardAction = {
          KeyC: copyClips,
          KeyX: cutClips,
          KeyV: pasteClips,
          KeyD: duplicateClips,
        }[e.code]
        if (clipboardAction) {
          e.preventDefault()
          clipboardAction()
          return
        }
      }

      if (isMeta) return
      if (isContentEditable && e.code !== 'Space') return
      // Canonical text edits are resolved by the transcript, never as a broad timeline range.
      if (
        useTranscriptStore.getState().selectedTranscriptUnitIds.size > 0 &&
        ['KeyS', 'KeyM', 'KeyU', 'Delete', 'Backspace'].includes(e.code)
      )
        return
      // Space activates native controls on keyup. Leave its default action intact.
      if (
        e.code === 'Space' &&
        !e.altKey &&
        !e.shiftKey &&
        target.closest('button, summary, select')
      )
        return

      switch (e.code) {
        // ── Space — Play / Pause ───────────────────────────────────────────
        case 'Space': {
          e.preventDefault()
          if (!player) break

          togglePlayback().catch(console.error)
          break
        }

        // ── S — Split clip at playhead ─────────────────────────────────────
        case 'KeyS': {
          e.preventDefault()
          splitAtPlayhead()
          break
        }

        // ── M — Mute selected region ───────────────────────────────────────
        case 'KeyM': {
          if (!selection && !useTimelineStore.getState().selectedClipId) break
          e.preventDefault()
          muteSelection()
          break
        }

        // ── U — Unmute ─────────────────────────────────────────────────────
        // If clips are selected, unmute them atomically.
        // Otherwise unmute all muted clips overlapping the drag-selection.
        case 'KeyU': {
          e.preventDefault()
          unmuteSelection()
          break
        }

        // ── Delete / Backspace ─────────────────────────────────────────────
        // If clips or an overlay are selected: remove them.
        // If a drag-selection is active: add a redaction.
        case 'Delete':
        case 'Backspace': {
          if (
            !useTimelineStore.getState().selectedClipId &&
            !useTimelineStore.getState().timelineSelection &&
            !selection
          )
            break
          e.preventDefault()
          deleteSelection()
          break
        }

        // ── Escape — Clear selection + deselect clip ───────────────────────
        case 'Escape': {
          e.preventDefault()
          setSelection(null)
          useTimelineStore.getState().setSelectedClipIds([])
          break
        }

        // ── Arrow keys — Nudge playhead ────────────────────────────────────
        case 'ArrowLeft': {
          if (!player) break
          e.preventDefault()
          const amount = e.shiftKey ? 5 : 1
          player.seekTo(Math.max(0, player.getCurrentTime() - amount))
          break
        }

        case 'ArrowRight': {
          if (!player) break
          e.preventDefault()
          const amount = e.shiftKey ? 5 : 1
          player.seekTo(Math.min(player.getDuration(), player.getCurrentTime() + amount))
          break
        }

        default:
          break
      }
    }

    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [selection, setSelection, onSave])
}
