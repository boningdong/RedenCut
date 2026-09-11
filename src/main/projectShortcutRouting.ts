import type { WebContents } from 'electron'

/** Deliver project chords to the renderer instead of Electron's default Edit menu. */
export function routeProjectShortcuts(
  contents: Pick<WebContents, 'on' | 'setIgnoreMenuShortcuts'>,
): void {
  contents.on('before-input-event', (_event, input) => {
    const projectChord =
      input.type === 'keyDown' &&
      !input.isComposing &&
      !input.alt &&
      (input.meta || input.control) &&
      (input.code === 'KeyZ' || (input.code === 'KeyS' && !input.shift))
    // Keep page key events and native text-input editing; suppress only menu accelerators.
    contents.setIgnoreMenuShortcuts(projectChord)
  })
}
