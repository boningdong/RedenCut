import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ProjectCloseGuard } from './ProjectCloseGuard'
class Sender extends EventEmitter {
  id = 17
  send = vi.fn()
  isDestroyed = () => false
}
describe('project close guard', () => {
  it('shares pending requests and accepts only the owning renderer response', async () => {
    const guard = new ProjectCloseGuard()
    const sender = new Sender()
    const first = guard.request(sender)
    expect(guard.request(sender)).toBe(first)
    const requestId = sender.send.mock.calls[0][1].requestId
    expect(guard.respond(99, requestId, true)).toBe(false)
    expect(guard.respond(17, requestId, false)).toBe(true)
    expect(await first).toBe(false)
    const retry = guard.request(sender)
    guard.respond(17, sender.send.mock.calls[1][1].requestId, true)
    expect(await retry).toBe(true)
  })
  it('fails closed when the renderer is destroyed', async () => {
    const guard = new ProjectCloseGuard()
    const sender = new Sender()
    const pending = guard.request(sender)
    sender.emit('destroyed')
    expect(await pending).toBe(false)
  })
})

it('does not wait for a renderer that already crashed', async () => {
  const guard = new ProjectCloseGuard()
  const sender = Object.assign(new Sender(), { isCrashed: () => true })
  expect(await guard.request(sender)).toBe(false)
  expect(sender.send).not.toHaveBeenCalled()
})
