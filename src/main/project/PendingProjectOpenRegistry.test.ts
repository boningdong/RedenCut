import { describe, expect, it } from 'vitest'
import { PendingProjectOpenRegistry } from './PendingProjectOpenRegistry'

describe('PendingProjectOpenRegistry', () => {
  it('keeps paths behind opaque sender-bound one-use identifiers', () => {
    const registry = new PendingProjectOpenRegistry({ createId: () => 'opaque-request' })
    const pending = registry.issue(7, '/private/projects/Episode.podcut')

    expect(pending).toEqual({ requestId: 'opaque-request', displayName: 'Episode' })
    expect(JSON.stringify(pending)).not.toContain('/private/projects')
    expect(() => registry.consume(8, pending.requestId)).toThrow(
      'Pending project request is invalid',
    )
    expect(registry.consume(7, pending.requestId)).toBe('/private/projects/Episode.podcut')
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
    const pending = registry.issue(7, '/private/projects/Episode.podcut')

    now = 1_101
    expect(() => registry.consume(7, pending.requestId)).toThrow(
      'Pending project request is invalid',
    )
  })
})
