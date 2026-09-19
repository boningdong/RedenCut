import { speakerIdentityEqual as same } from '@shared/SpeakerIdentityEquality'
import type { RendererSession } from '@shared/session.types'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import { reconcileSpeakerIdentities } from '@shared/SpeakerIdentityReconciler'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/TimelineStore'
import { useEditorHistoryStore } from '../stores/EditorHistoryStore'
export type PublishSpeakerSession = (session: RendererSession) => Promise<void>
/** Restore only entities touched by this edit; unrelated new analyses/people survive. */
function restoreCatalog(
  current: SpeakerIdentityCatalog,
  from: SpeakerIdentityCatalog,
  to: SpeakerIdentityCatalog,
): SpeakerIdentityCatalog {
  const restore = <T extends { id: string }>(now: T[], old: T[], next: T[]): T[] => {
    const touched = new Set(
      [...old, ...next]
        .map((x) => x.id)
        .filter(
          (id) =>
            !same(
              old.find((x) => x.id === id),
              next.find((x) => x.id === id),
            ),
        ),
    )
    for (const id of touched)
      if (
        !same(
          now.find((x) => x.id === id),
          old.find((x) => x.id === id),
        )
      )
        throw new Error('Speaker identities changed')
    return [
      ...now.flatMap((x) => (touched.has(x.id) ? (next.find((y) => y.id === x.id) ?? []) : x)),
      ...next.filter((x) => touched.has(x.id) && !now.some((y) => y.id === x.id)),
    ]
  }
  return {
    version: 1,
    people: restore(current.people, from.people, to.people),
    associations: restore(current.associations, from.associations, to.associations),
  }
}
export async function saveSpeakerIdentities(
  expected: SpeakerIdentityCatalog,
  next: SpeakerIdentityCatalog,
  publish: PublishSpeakerSession,
): Promise<void> {
  const session = useEditorStore.getState().session
  if (!session) throw new Error('No active project')
  if (same(expected, next)) return
  const token = session.workspaceToken
  const apply = async (before: SpeakerIdentityCatalog, after: SpeakerIdentityCatalog) => {
    if (useEditorStore.getState().session?.workspaceToken !== token)
      throw new Error('Project changed')
    const updated = await window.electronAPI.speakerIdentity.save({
      workspaceToken: token,
      expected: before,
      next: after,
    })
    if (useEditorStore.getState().session?.workspaceToken !== token) return false
    await publish(updated)
    if (useEditorStore.getState().session?.workspaceToken === token)
      useEditorStore.getState().markEdited()
    return useEditorStore.getState().session?.workspaceToken === token
  }
  if (!(await apply(expected, next))) return
  const restore = async (from: SpeakerIdentityCatalog, to: SpeakerIdentityCatalog) => {
    const current = useEditorStore.getState().session
    if (!current || current.workspaceToken !== token) throw new Error('Project changed')
    const catalog = reconcileSpeakerIdentities(
      current.speakerIdentities,
      current.speechAnalyses,
      useTimelineStore.getState().tracks,
    )
    await apply(catalog, restoreCatalog(catalog, from, to))
  }
  useEditorHistoryStore.getState().record({
    label: 'Edit people',
    undo: () => restore(next, expected),
    redo: () => restore(expected, next),
  })
}
