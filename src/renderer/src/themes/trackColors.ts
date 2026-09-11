/** New defaults and presentation aliases for the pre-release default palette.
 * Other saved colors pass through without changing project metadata. */
export const TRACK_COLORS = ['#cf7ba6', '#70b7b1', '#c8aa71', '#a393ee', '#7ca7c8']
const legacyColors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6']
export function trackPresentationColor(color: string): string {
  const index = legacyColors.indexOf(color.toLowerCase())
  return index < 0 ? color : TRACK_COLORS[index]
}
