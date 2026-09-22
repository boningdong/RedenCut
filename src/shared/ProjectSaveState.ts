/** Temporary media is durable only after the user chooses a project destination. */
export function needsProjectSave(
  session: {
    workspace: { kind: 'temporary' | 'saved' }
    sources: readonly unknown[]
    draft: { tracks: readonly unknown[] }
  },
  isDirty: boolean,
): boolean {
  return (
    isDirty ||
    (session.workspace.kind === 'temporary' &&
      (session.sources.length > 0 || session.draft.tracks.length > 0))
  )
}
