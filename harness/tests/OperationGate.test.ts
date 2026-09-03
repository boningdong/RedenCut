import { expect, test } from 'vitest'
import { OperationGate } from '../runtime/OperationGate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('serializes UI work and closes admission while lifecycle waits for accepted work', async () => {
  const gate = new OperationGate()
  const pending = deferred()
  const events: string[] = []
  const first = gate.runUi(async () => {
    events.push('first')
    await pending.promise
  })
  const second = gate.runUi(async () => {
    events.push('second')
  })
  const lifecycle = gate.runLifecycle(async () => {
    events.push('restart')
  }, 1000)
  await expect(
    gate.runUi(async () => {
      events.push('unexpected')
    }),
  ).rejects.toThrow('LIFECYCLE_BUSY')
  expect(events).toEqual(['first'])
  pending.resolve()
  await Promise.all([first, second, lifecycle])
  expect(events).toEqual(['first', 'second', 'restart'])
})

test('times out lifecycle admission without running its mutation or replaying UI work', async () => {
  const gate = new OperationGate()
  const pending = deferred()
  let calls = 0
  let lifecycleCalls = 0
  const active = gate.runUi(async () => {
    calls += 1
    await pending.promise
  })
  await expect(
    gate.runLifecycle(async () => {
      lifecycleCalls += 1
    }, 10),
  ).rejects.toThrow('UI_DRAIN_TIMEOUT')
  expect(lifecycleCalls).toBe(0)
  pending.resolve()
  await active
  expect(calls).toBe(1)
})

test('releases the queue after a failed UI operation without hiding the failure', async () => {
  const gate = new OperationGate()
  await expect(
    gate.runUi(async () => {
      throw new Error('failed-click')
    }),
  ).rejects.toThrow('failed-click')
  await expect(gate.runUi(async () => 'next')).resolves.toBe('next')
})
