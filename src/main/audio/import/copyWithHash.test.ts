import { createHash } from 'crypto'
import { Readable, Writable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { copyWithHash } from './copyWithHash'

describe('copyWithHash', () => {
  it('turns an asynchronous writer ENOSPC into one controlled rejection and removes pipeline listeners', async () => {
    const input = Readable.from([Buffer.from('first'), Buffer.from('second')])
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        queueMicrotask(() => callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' })))
      },
    })

    await expect(
      copyWithHash('/source', '/destination', new AbortController().signal, undefined, {
        createInput: () => input,
        createOutput: () => output,
      }),
    ).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(input.destroyed).toBe(true)
    expect(output.destroyed).toBe(true)
    expect(input.listenerCount('error')).toBe(0)
    expect(output.listenerCount('error')).toBe(0)
  })

  it('copies exact bytes while hashing, counting, and reporting cumulative progress', async () => {
    const chunks = [Buffer.from('first'), Buffer.from('-second')]
    const written: Buffer[] = []
    const progress = vi.fn()
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written.push(Buffer.from(chunk))
        callback()
      },
    })

    await expect(
      copyWithHash('/source', '/destination', new AbortController().signal, progress, {
        createInput: () => Readable.from(chunks),
        createOutput: () => output,
      }),
    ).resolves.toEqual({
      byteLength: 12,
      sha256: createHash('sha256').update('first-second').digest('hex'),
    })
    expect(Buffer.concat(written).toString()).toBe('first-second')
    expect(progress.mock.calls.map(([bytes]) => bytes)).toEqual([5, 12])
  })

  it('normalizes pipeline cancellation to the import AbortError contract', async () => {
    const controller = new AbortController()
    const input = new Readable({ read() {} })
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    const copying = copyWithHash('/source', '/destination', controller.signal, undefined, {
      createInput: () => input,
      createOutput: () => output,
    })

    controller.abort()

    await expect(copying).rejects.toMatchObject({ name: 'AbortError' })
    expect(input.destroyed).toBe(true)
    expect(output.destroyed).toBe(true)
    expect(input.listenerCount('error')).toBe(0)
    expect(output.listenerCount('error')).toBe(0)
  })
})
