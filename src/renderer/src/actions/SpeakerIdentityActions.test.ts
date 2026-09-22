import { beforeEach, expect, it, vi } from 'vitest'
import type { RendererSession } from '@shared/session.types'
import type {
  SpeakerIdentityCatalog,
  SaveSpeakerIdentitiesRequest,
} from '@shared/SpeakerIdentityTypes'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/TimelineStore'
import { useEditorHistoryStore } from '../stores/EditorHistoryStore'
import { saveSpeakerIdentities } from './SpeakerIdentityActions'
const before: SpeakerIdentityCatalog = {
  version: 1,
  people: [
    {
      id: 'a',
      displayName: 'A',
      color: '#abcdef',
      binding: { audioSourceId: 's', analysisRevisionId: 'r', speakerId: 'p' } as never,
    },
  ],
  associations: [],
}
const after = { ...before, people: [{ ...before.people[0], displayName: 'Alice' }] }
const session = {
  workspaceToken: 'w',
  revision: 1,
  speakerIdentities: before,
  speechAnalyses: [],
  draft: { tracks: [], export: {} },
} as unknown as RendererSession
beforeEach(() => {
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
  useEditorHistoryStore.getState().reset()
  useEditorStore.getState().loadSession(session)
})
it('publishes through the background session merger and records reversible metadata only', async () => {
  const save = vi.fn(async (request) => ({
    ...session,
    revision: 2,
    speakerIdentities: request.next,
  }))
  vi.stubGlobal('window', { electronAPI: { speakerIdentity: { save } } })
  const publish = vi.fn(async (s: RendererSession) => {
    useEditorStore.getState().loadSession(s, true)
  })
  await saveSpeakerIdentities(before, after, publish)
  expect(publish).toHaveBeenCalledTimes(1)
  expect(useTimelineStore.getState().undoStack).toHaveLength(1)
  await useTimelineStore.getState().undo()
  expect(save.mock.calls[1][0].next).toEqual(before)
  await useTimelineStore.getState().redo()
  expect(save.mock.calls[2][0].next).toEqual(after)
})
it('preserves identities added by another audio when undoing a prior rename', async () => {
  const save = vi.fn(async (request) => ({
    ...session,
    revision: 2,
    speakerIdentities: request.next,
  }))
  vi.stubGlobal('window', { electronAPI: { speakerIdentity: { save } } })
  const publish = async (s: RendererSession) => {
    useEditorStore.getState().loadSession(s, true)
  }
  await saveSpeakerIdentities(before, after, publish)
  const newcomer = {
    ...before.people[0],
    id: 'b',
    binding: { ...before.people[0].binding, audioSourceId: 'other' as never },
  }
  useEditorStore.setState({
    session: { ...session, speakerIdentities: { ...after, people: [...after.people, newcomer] } },
  })
  await useTimelineStore.getState().undo()
  expect(save.mock.calls[1][0].next.people).toEqual([...before.people, newcomer])
})
it('ignores completion after switching projects and does not add undo history', async () => {
  let resolve!: (s: RendererSession) => void
  vi.stubGlobal('window', {
    electronAPI: {
      speakerIdentity: {
        save: () =>
          new Promise<RendererSession>((r) => {
            resolve = r
          }),
      },
    },
  })
  const publish = vi.fn(async () => {})
  const pending = saveSpeakerIdentities(before, after, publish)
  useEditorStore.setState({ session: { ...session, workspaceToken: 'other' as never } })
  resolve({ ...session, speakerIdentities: after })
  await pending
  expect(publish).not.toHaveBeenCalled()
  expect(useTimelineStore.getState().undoStack).toHaveLength(0)
})
it('can redo after persisted objects return in schema field order', async () => {
  const original = {
    ...before,
    people: before.people.map((p) => ({
      id: p.id,
      binding: p.binding,
      displayName: p.displayName,
      color: p.color,
    })),
  }
  const edited = {
    ...after,
    people: after.people.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      color: p.color,
      binding: p.binding,
    })),
  }
  useEditorStore.setState({ session: { ...session, speakerIdentities: original } })
  const save = vi.fn(async (request) => ({
    ...session,
    speakerIdentities: {
      ...request.next,
      people: request.next.people.map((p: (typeof before.people)[number]) => ({
        id: p.id,
        displayName: p.displayName,
        color: p.color,
        binding: p.binding,
      })),
    },
  }))
  vi.stubGlobal('window', { electronAPI: { speakerIdentity: { save } } })
  await saveSpeakerIdentities(original, edited, async (s) => {
    useEditorStore.getState().loadSession(s, true)
  })
  await useTimelineStore.getState().undo()
  await useTimelineStore.getState().redo()
  expect(useEditorHistoryStore.getState().error).toBeNull()
  expect(useEditorStore.getState().session?.speakerIdentities?.people[0].displayName).toBe('Alice')
})

it('round-trips historical membership cleanup through renderer undo/redo', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const catalog: SpeakerIdentityCatalog = {
    version: 1,
    people: [1, 2].map((n) => ({
      id: `person-${n}`,
      displayName: `Person ${n}`,
      color: '#112233',
      binding: {
        audioSourceId: id(n) as never,
        analysisRevisionId: id(n + 10) as never,
        speakerId: id(n + 20) as never,
      },
    })),
    associations: [
      {
        id: 'hosts',
        displayName: 'Hosts',
        color: { mode: 'automatic' },
        memberPersonIds: ['person-1', 'person-2'],
      },
    ],
  }
  let current = {
    workspaceToken: 'workspace',
    revision: 1,
    speakerIdentities: catalog,
    speechAnalyses: [],
    draft: { tracks: [], export: {} },
  } as unknown as RendererSession
  useEditorStore.getState().reset()
  useTimelineStore.getState().reset()
  useEditorHistoryStore.getState().reset()
  useEditorStore.getState().loadSession(current)
  vi.stubGlobal('window', {
    electronAPI: {
      speakerIdentity: {
        save: async (request: SaveSpeakerIdentitiesRequest) => {
          expect(request.expected).toEqual(current.speakerIdentities)
          const next = request.next
          current = { ...current, speakerIdentities: next }
          return current
        },
      },
    },
  })
  try {
    await saveSpeakerIdentities(catalog, { ...catalog, associations: [] }, async (session) => {
      useEditorStore.getState().loadSession(session, true)
    })
    expect(current.speakerIdentities?.associations).toEqual([])
    await useTimelineStore.getState().undo()
    expect(useEditorHistoryStore.getState().error).toBeNull()
    expect(current.speakerIdentities).toEqual(catalog)
    await useTimelineStore.getState().redo()
    expect(useEditorHistoryStore.getState().error).toBeNull()
    expect(current.speakerIdentities?.associations).toEqual([])
    expect(current.speakerIdentities?.people).toEqual(catalog.people)
  } finally {
    vi.unstubAllGlobals()
  }
})
