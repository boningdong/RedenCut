// ─────────────────────────────────────────────────────────────────────────────
// useKeyboardShortcuts
//
// Registers document-level keydown listeners for all editor shortcuts.
// Must be mounted once at the App level.
//
// Shortcuts:
//   Space                  — Play / Pause (via IAudioPlayer)
//   S                      — Split clip at playhead
//   M                      — Mute selected region (waveform drag-selection)
//   U                      — Unmute: remove selected clip or overlapping clips
//   Delete / Backspace     — If clip selected: remove it (unmute); else mute drag-selection
//   Escape                 — Clear selection + deselect clip
//   ← / →                  — Nudge playhead ±1 s
//   Shift+← / Shift+→     — Nudge playhead ±5 s
//   Cmd+S / Ctrl+S         — Save project
//   Cmd+Z / Ctrl+Z         — Undo last timeline operation
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'
import { useTranscriptStore } from '../stores/transcript.store'
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
      const target = e.target as HTMLElement

      // Don't intercept while typing in a real input field.
      // contentEditable (transcript panel) gets a carve-out for Space so the
      // user can play/pause without clicking away from the transcript first.
      const isTypingField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const isContentEditable = target.isContentEditable
      if (isTypingField) return
      if (isContentEditable && e.code !== 'Space') return

      const isMeta = e.metaKey || e.ctrlKey
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
        useTimelineStore.getState().undo()
        return
      }

      // ── Cmd+Shift+Z — Redo ────────────────────────────────────────────
      if (isMeta && e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault()
        useTimelineStore.getState().redo()
        return
      }

      if (isMeta) return

      switch (e.code) {
        // ── Space — Play / Pause ───────────────────────────────────────────
        case 'Space': {
          e.preventDefault()
          if (!player) break

          // Preview Mode: if playhead is inside a muted clip, skip to its end first
          if (!player.isPlaying()) {
            const { previewMode } = useEditorStore.getState()
            if (previewMode) {
              const t = player.getCurrentTime()
              const clips = useTimelineStore.getState().tracks.flatMap((tr) => tr.clips)
              const inside = clips.find((c) => {
                if (!c.muted) return false
                const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
                return t >= c.outputStart && t < outputEnd
              })
              if (inside) {
                const outputEnd = inside.outputStart + (inside.sourceEnd - inside.sourceStart)
                player.seekTo(outputEnd)
              }
            }
          }
          player.playPause().catch(console.error)
          break
        }

        // ── S — Split clip at playhead ─────────────────────────────────────
        case 'KeyS': {
          e.preventDefault()
          if (!player) break
          const time = player.getCurrentTime()
          console.log(`[Shortcuts] S — split at ${time.toFixed(2)}s`)
          useTimelineStore.getState().splitAt(time)
          break
        }

        // ── M — Mute selected region ───────────────────────────────────────
        case 'KeyM': {
          if (!selection) break
          e.preventDefault()
          const { sourceFiles } = useTimelineStore.getState()
          const sfId = sourceFiles[0]?.id
          if (!sfId) break
          // Collect word IDs for transcript muting
          const wordIds = useTranscriptStore.getState().selectedWordIds
          console.log(
            `[Shortcuts] M — mute [${selection.start.toFixed(2)}–${selection.end.toFixed(2)}]`,
          )
          useTimelineStore.getState().muteRange(sfId, selection.start, selection.end, [...wordIds])
          setSelection(null)
          break
        }

        // ── U — Unmute ─────────────────────────────────────────────────────
        // If a clip region is selected, unmute it.
        // Otherwise unmute all muted clips overlapping the drag-selection.
        case 'KeyU': {
          e.preventDefault()
          const { selectedClipId, tracks, unmuteClip } = useTimelineStore.getState()
          if (selectedClipId) {
            console.log(`[Shortcuts] U — unmute selected clip ${selectedClipId}`)
            unmuteClip(selectedClipId)
            break
          }
          if (!selection) break
          const overlapping = tracks
            .flatMap((t) => t.clips)
            .filter((c) => {
              if (!c.muted) return false
              const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
              return c.outputStart < selection.end && outputEnd > selection.start
            })
          overlapping.forEach((c) => {
            console.log(`[Shortcuts] U — unmuting clip ${c.id}`)
            useTimelineStore.getState().unmuteClip(c.id)
          })
          setSelection(null)
          break
        }

        // ── Delete / Backspace ─────────────────────────────────────────────
        // If a clip region is selected: remove it.
        // If a drag-selection is active: add a mute.
        case 'Delete':
        case 'Backspace': {
          const { selectedClipId, tracks, removeClip } = useTimelineStore.getState()
          if (selectedClipId) {
            e.preventDefault()
            console.log(`[Shortcuts] Delete — remove clip ${selectedClipId}`)
            removeClip(selectedClipId)
            break
          }
          if (!selection) break
          e.preventDefault()
          const { sourceFiles } = useTimelineStore.getState()
          const sfId = sourceFiles[0]?.id
          if (!sfId) break
          const wordIds = useTranscriptStore.getState().selectedWordIds
          // Mute overlapping clips
          const hits = tracks
            .flatMap((t) => t.clips)
            .filter((c) => {
              if (c.muted) return false
              const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
              return c.outputStart < selection.end && outputEnd > selection.start
            })
          if (hits.length > 0) {
            console.log(
              `[Shortcuts] Delete — mute [${selection.start.toFixed(2)}–${selection.end.toFixed(2)}]`,
            )
            useTimelineStore
              .getState()
              .muteRange(sfId, selection.start, selection.end, [...wordIds])
          }
          setSelection(null)
          break
        }

        // ── Escape — Clear selection + deselect clip ───────────────────────
        case 'Escape': {
          e.preventDefault()
          setSelection(null)
          useTimelineStore.getState().setSelectedClipId(null)
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
