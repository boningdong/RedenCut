import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'events'
import {
  PendingProjectOpenRegistry,
  removePendingProjectOpensOnSenderDestroyed,
} from './PendingProjectOpenRegistry'

describe('PendingProjectOpenRegistry', () => {
  it('keeps paths behind opaque sender-bound one-use identifiers', () => {
    const registry = new PendingProjectOpenRegistry({ createId: () => 'opaque-request' })
    const pending = registry.issue(7, '/private/projects/Episode.riffcut')

    expect(pending).toEqual({ requestId: 'opaque-request', displayName: 'Episode' })
    expect(JSON.stringify(pending)).not.toContain('/private/projects')
    expect(() => registry.consume(8, pending.requestId)).toThrow(
      'Pending project request is invalid',
    )
    expect(registry.consume(7, pending.requestId)).toBe('/private/projects/Episode.riffcut')
    expect(() => registry.consume(7, pending.requestId)).toThrow(
      'Pending project request is invalid',
    )
  })

  it('rejects expired identifiers without revealing the retained path', () => {
    let now = 100
    const registry = new PendingProjectOpenRegistry({
      createId: () => 'opaque-request',
      now: () => now,
      ttlMs: 1_000,
    })
    const pending = registry.issue(7, '/private/projects/Episode.riffcut')

    now = 1_101
    expect(() => registry.consume(7, pending.requestId)).toThrow(
      'Pending project request is invalid',
    )
  })

  it('sweeps every expired path entry when issuing or consuming another request', () => {
    let now = 100
    let id = 0
    const registry = new PendingProjectOpenRegistry({
      createId: () => `opaque-${++id}`,
      now: () => now,
      ttlMs: 1_000,
    })
    registry.issue(7, '/private/projects/Expired-on-issue.riffcut')
    now = 1_100
    registry.issue(8, '/private/projects/Fresh.riffcut')
    expect(entryCount(registry)).toBe(1)

    registry.issue(7, '/private/projects/Expired-on-consume.riffcut')
    now = 1_600
    registry.issue(8, '/private/projects/Fresh-on-consume.riffcut')
    now = 2_100
    expect(registry.consume(8, 'opaque-4')).toBe('/private/projects/Fresh-on-consume.riffcut')
    expect(entryCount(registry)).toBe(0)
  })

  it('removes all paths owned by a destroyed sender without consuming their exact IDs', () => {
    let id = 0
    const registry = new PendingProjectOpenRegistry({ createId: () => `opaque-${++id}` })
    const sender = Object.assign(new EventEmitter(), { id: 7 })
    removePendingProjectOpensOnSenderDestroyed(registry, sender)
    const first = registry.issue(sender.id, '/private/projects/First.riffcut')
    const second = registry.issue(sender.id, '/private/projects/Second.riffcut')
    const other = registry.issue(8, '/private/projects/Other.riffcut')

    sender.emit('destroyed')

    expect(entryCount(registry)).toBe(1)
    expect(() => registry.consume(sender.id, first.requestId)).toThrow(
      'Pending project request is invalid',
    )
    expect(() => registry.consume(sender.id, second.requestId)).toThrow(
      'Pending project request is invalid',
    )
    expect(registry.consume(8, other.requestId)).toBe('/private/projects/Other.riffcut')
  })
})

function entryCount(registry: PendingProjectOpenRegistry): number {
  return (registry as unknown as { entries: Map<string, { path: string }> }).entries.size
}
