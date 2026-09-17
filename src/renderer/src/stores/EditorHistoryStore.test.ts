import { beforeEach, expect, it, vi } from 'vitest'
import { useTimelineStore } from './timeline.store'
import { useEditorHistoryStore } from './EditorHistoryStore'
import type { Track } from '@shared/project.types'

const tracks: Track[] = [
  {
    id: 't',
    name: 'Original',
    color: '#abcdef',
    volume: 1,
    muted: false,
    solo: false,
    clips: [],
    effects: [],
  },
]
beforeEach(() => {
  useTimelineStore.getState().reset()
  useEditorHistoryStore.getState().reset()
  useTimelineStore.setState({ tracks: structuredClone(tracks) })
})
it('undoes identity and track operations in their actual order without restoring unrelated domains', async () => {
  let name = 'Renamed'
  useTimelineStore
    .getState()
    .commitTracks(
      useTimelineStore.getState().tracks,
      [{ ...tracks[0], name: 'Changed track' }],
      'Change track',
    )
  useEditorHistoryStore.getState().record({
    label: 'Rename person',
    undo: async () => {
      name = 'Original person'
    },
    redo: async () => {
      name = 'Renamed'
    },
  })
  await useTimelineStore.getState().undo()
  expect(name).toBe('Original person')
  expect(useTimelineStore.getState().tracks[0].name).toBe('Changed track')
  await useTimelineStore.getState().undo()
  expect(useTimelineStore.getState().tracks[0].name).toBe('Original')
  expect(name).toBe('Original person')
  await useTimelineStore.getState().redo()
  await useTimelineStore.getState().redo()
  expect(name).toBe('Renamed')
  expect(useTimelineStore.getState().tracks[0].name).toBe('Changed track')
})
it('leaves a failed identity undo in history for retry and reports an error', async () => {
  let fails = true
  const undo = vi.fn(async () => {
    if (fails) throw new Error('stale')
  })
  useEditorHistoryStore.getState().record({ label: 'People', undo, redo: async () => {} })
  await useTimelineStore.getState().undo()
  expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  expect(useEditorHistoryStore.getState().error).not.toBeNull()
  fails = false
  await useTimelineStore.getState().undo()
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  expect(useTimelineStore.getState().redoStack).toHaveLength(1)
  expect(useEditorHistoryStore.getState().error).toBeNull()
})
it('does not apply a pending history result to a different loaded project', async () => {
  let finish!: () => void
  useEditorHistoryStore.getState().record({
    label: 'People',
    undo: () =>
      new Promise<void>((r) => {
        finish = r
      }),
    redo: async () => {},
  })
  const result = useTimelineStore.getState().undo()
  useTimelineStore.getState().loadFromProject([], [])
  finish()
  await result
  expect(useTimelineStore.getState().undoStack).toEqual([])
  expect(useTimelineStore.getState().redoStack).toEqual([])
})

it('keeps a completed redo undoable when a clip edit clears its pending redo entry', async () => {
  let finish!: () => void
  useEditorHistoryStore.getState().record({
    label: 'People',
    undo: async () => {},
    redo: () =>
      new Promise<void>((r) => {
        finish = r
      }),
  })
  await useTimelineStore.getState().undo()
  const pending = useTimelineStore.getState().redo()
  useTimelineStore
    .getState()
    .commitTracks(
      useTimelineStore.getState().tracks,
      [{ ...tracks[0], name: 'During redo' }],
      'Track edit',
    )
  finish()
  await pending
  expect(useTimelineStore.getState().undoStack.map((entry) => entry.label)).toEqual([
    'Track edit',
    'People',
  ])
})
