/** Identity metadata is JSON data; property insertion order is not part of its meaning. */
export function speakerIdentityEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => speakerIdentityEqual(value, right[index]))
    )
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && speakerIdentityEqual(a[key], b[key]),
    )
  )
}
