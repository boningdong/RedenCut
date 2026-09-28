import type { Track } from '@shared/ProjectTypes'

/** Timeline metadata is plain, finite, serializable data; shared branches need no traversal. */
export function timelineValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => timelineValuesEqual(value, right[index]))
    )
  }
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  // Absent optional fields and explicit undefined have the same persisted meaning.
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && timelineValuesEqual(a[key], b[key]),
    )
  )
}

const protectedObjects = new WeakSet<object>()
function freezeMetadata(value: unknown): void {
  if (!value || typeof value !== 'object' || protectedObjects.has(value)) return
  for (const child of Object.values(value)) freezeMetadata(child)
  Object.freeze(value)
  protectedObjects.add(value)
}

/** Catch writes to shared undo objects in development without production traversal cost. */
export function protectTimelineSnapshot(tracks: Track[]): Track[] {
  if (import.meta.env.DEV) freezeMetadata(tracks)
  return tracks
}
