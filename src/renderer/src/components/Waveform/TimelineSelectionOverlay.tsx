import type { EditorSelection } from '../../stores/editor.store'

export function TimelineSelectionOverlay({
  selection,
  pxPerSec,
  trackColor,
}: {
  selection: EditorSelection
  pxPerSec: number
  trackColor?: string
}) {
  if (selection.origin === 'clip') return null
  return (
    <div
      aria-hidden="true"
      data-range-selection={selection.origin}
      data-range-scope={trackColor ? 'track' : 'timeline'}
      style={{
        position: 'absolute',
        left: selection.start * pxPerSec,
        width: (selection.end - selection.start) * pxPerSec,
        top: 0,
        bottom: 0,
        background: `color-mix(in srgb, ${trackColor ?? 'var(--color-accent)'} ${trackColor ? 22 : 10}%, transparent)`,
        borderInline: `1px solid color-mix(in srgb, ${trackColor ?? 'var(--color-accent)'} 65%, transparent)`,
        ...(trackColor && {
          borderBlock: `1px solid color-mix(in srgb, ${trackColor} 65%, transparent)`,
        }),
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: trackColor ? 26 : 25,
      }}
    />
  )
}
