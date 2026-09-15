import { spawn } from 'child_process'
import { describe, expect, it, vi } from 'vitest'
import { manageProcess } from './ManagedProcess'

const launch = (code: string) => () => spawn(process.execPath, ['-e', code])

describe('managed subprocess lifecycle', () => {
  it('classifies a synchronous startup failure', async () => {
    const operation = manageProcess(() => {
      throw new Error('invalid executable')
    }, new AbortController().signal)
    await expect(operation.completed).rejects.toMatchObject({
      kind: 'startup',
      message: 'invalid executable',
    })
  })

  it('rejects even when a parser throws an undefined value', async () => {
    const operation = manageProcess(
      launch(
        `process.on('SIGTERM',()=>process.exit(0));console.log('ready');setInterval(()=>{},1000)`,
      ),
      new AbortController().signal,
      {
        onStdout: () => {
          throw undefined
        },
      },
    )
    await expect(operation.completed).rejects.toBeInstanceOf(Error)
  })

  it('drains both pipes without retaining unlimited diagnostics', async () => {
    const operation = manageProcess(
      launch(
        `process.stdout.write('x'.repeat(8*1024*1024)); process.stderr.write('y'.repeat(1024*1024));`,
      ),
      new AbortController().signal,
    )
    const result = await operation.completed
    expect(result.code).toBe(0)
    expect(Buffer.byteLength(result.diagnostics)).toBeLessThanOrEqual(16 * 1024)
    expect(result.diagnostics.endsWith('y')).toBe(true)
  })

  it('does not spawn for an already cancelled operation', async () => {
    const factory = vi.fn(launch(''))
    const abort = new AbortController()
    abort.abort()
    await expect(manageProcess(factory, abort.signal).completed).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(factory).not.toHaveBeenCalled()
  })

  it('escalates cancellation when a ready child ignores SIGTERM', async () => {
    const abort = new AbortController()
    const operation = manageProcess(
      launch(`process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('ready')`),
      abort.signal,
      {
        terminateGraceMs: 30,
        onStdout: () => abort.abort(),
      },
    )
    await expect(operation.completed).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('settles a failed spawn without an unhandled input error', async () => {
    const operation = manageProcess(
      () => spawn('/definitely/missing/redencut', []),
      new AbortController().signal,
    )
    await expect(operation.completed).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('terminates a child when its output parser throws', async () => {
    const operation = manageProcess(
      launch(`console.log('bad');setInterval(()=>{},1000)`),
      new AbortController().signal,
      {
        onStdout: () => {
          throw new Error('invalid protocol')
        },
      },
    )
    await expect(operation.completed).rejects.toThrow('invalid protocol')
  })

  it('does not wait forever for output pipes inherited by a descendant', async () => {
    const operation = manageProcess(
      launch(
        `const {spawn}=require('child_process'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},400)'],{stdio:['ignore',1,2]});c.unref();`,
      ),
      new AbortController().signal,
      { drainGraceMs: 30 },
    )
    await expect(operation.completed).rejects.toThrow('output streams did not close')
  })
})
