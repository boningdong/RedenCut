import { useCallback, useState, type MouseEvent } from 'react'
import type { Clip, Track } from '@shared/ProjectTypes'
import { getAudioPlayerInstance } from '@shared/PlayerTypes'
import { copyClips, cutClips, duplicateClips, pasteClips } from '../../actions/ClipClipboardActions'
import { useEditorStore } from '../../stores/editor.store'
import { useTimelineStore } from '../../stores/TimelineStore'
import { useTimelineClipboardStore } from '../../stores/TimelineClipboardStore'
import { useTranslation } from '../../i18n/useTranslation'
import { EditorContextMenu, type ContextMenuItem } from '../ui/EditorContextMenu'

export function useTimelineContextMenu(focusTimeline: () => void, onFailure: () => void) {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
    tracks: Track[]
    generation: number
  } | null>(null)
  const tracks = useTimelineStore((s) => s.tracks)
  const generation = useTimelineStore((s) => s.projectGeneration)
  const close = useCallback(() => setMenu(null), [])
  const open = (
    event: MouseEvent<HTMLElement>,
    trackId: string,
    additionalItems: ContextMenuItem[] = [],
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const state = useTimelineStore.getState()
    const track = state.tracks.find((track) => track.id === trackId)
    if (!track) return
    const clipId = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-id]')?.dataset
      .clipId
    const clip = track.clips.find((clip) => clip.id === clipId)
    const selectedRange = useEditorStore.getState().selection
    // A context click must not turn an existing range into a whole-clip edit.
    const range =
      selectedRange?.origin === 'timeline' &&
      selectedRange?.trackId === trackId &&
      clip &&
      selectedRange.start < clip.outputStart + clip.sourceEnd - clip.sourceStart &&
      selectedRange.end > clip.outputStart
        ? selectedRange
        : null
    focusTimeline()
    const ids = clip
      ? state.selectedClipIds.includes(clip.id)
        ? state.selectedClipIds
        : [clip.id]
      : []
    if (clip) {
      state.setSelectedTrackId(trackId)
      state.setSelectedClipIds(ids, clip.id)
    }
    if (selectedRange?.origin !== 'transcript')
      useEditorStore.getState().setSelection(selectedRange)
    const clips = state.tracks.flatMap((track) => track.clips).filter((c) => ids.includes(c.id))
    const valid = () =>
      useTimelineStore.getState().tracks === state.tracks &&
      useTimelineStore.getState().projectGeneration === state.projectGeneration
    const items: ContextMenuItem[] = [...additionalItems]
    if (range)
      items.push({
        id: 'redact',
        label: t('waveform.redactRange'),
        action: () => {
          if (!valid()) return
          useTimelineStore.getState().redactRange(trackId, range.start, range.end)
          useEditorStore.getState().setSelection(null)
        },
      })
    if (clip) {
      const player = getAudioPlayerInstance()
      const time = player?.getCurrentTime()
      items.push({
        id: 'split',
        label: t('waveform.splitAtPlayhead'),
        disabled:
          !player ||
          clips.length !== 1 ||
          time === undefined ||
          time <= clip.outputStart ||
          time >= clip.outputStart + clip.sourceEnd - clip.sourceStart,
        action: () => {
          if (valid())
            useTimelineStore.getState().splitAt(getAudioPlayerInstance()?.getCurrentTime() ?? -1)
        },
      })
      const muted = clips.every((c: Clip) => c.muted)
      items.push({
        id: 'mute',
        label: t(
          `waveform.${muted ? (clips.length > 1 ? 'unmuteClips' : 'unmuteClip') : clips.length > 1 ? 'muteClips' : 'muteClip'}`,
        ),
        action: () => {
          if (valid()) useTimelineStore.getState().setClipsMuted(ids, !muted)
        },
      })
      for (const [key, action] of [
        ['copyClips', copyClips],
        ['cutClips', cutClips],
        ['duplicateClips', duplicateClips],
      ] as const) {
        items.push({
          id: key,
          label: t(`waveform.${key}`),
          separator: key === 'copyClips',
          action: () => {
            if (valid() && !action()) onFailure()
          },
        })
      }
    }
    items.push({
      id: 'paste',
      label: t('waveform.pasteAtPlayhead'),
      disabled: !useTimelineClipboardStore.getState().contents,
      action: () => {
        if (!valid()) return
        useTimelineStore.getState().setSelectedTrackId(trackId)
        if (!pasteClips()) onFailure()
      },
    })
    if (clip)
      items.push({
        id: 'delete',
        label: t('waveform.deleteClips'),
        separator: true,
        action: () => {
          if (!valid()) return
          useTimelineStore.getState().removeClips(ids)
          useEditorStore.getState().setSelection(null)
        },
      })
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items,
      tracks: state.tracks,
      generation: state.projectGeneration,
    })
  }
  return {
    open,
    menu:
      menu && menu.tracks === tracks && menu.generation === generation ? (
        <EditorContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={close} />
      ) : null,
  }
}
