export function assertCloseAllowed(
  state: { dirty: boolean; busy: boolean },
  discardUnsaved: boolean,
): void {
  if (state.busy)
    throw new Error('APPLICATION_BUSY: wait for product jobs to settle before restart/stop')
  if (state.dirty && !discardUnsaved)
    throw new Error('UNSAVED_CHANGES: save through the UI or explicitly set discardUnsaved')
}
