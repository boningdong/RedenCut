import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { createWriteStream } from 'fs'
import { PassThrough } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import type { AudioSourceId } from '../../../shared/ProjectTypes'
import { FfmpegAudioSourceCacheBuilder } from './FfmpegAudioSourceCacheBuilder'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId

vi.mock('../../runtime/AppRuntimeLocator', () => ({ getFfmpegPath: () => '/test-runtime/ffmpeg' }))

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
}

function fakeBuilder(
  child: FakeChild,
  outputs: PassThrough[] = [],
  remove?: (path: string, options: { recursive: true; force: true }) => Promise<void>,
) {
  return new FfmpegAudioSourceCacheBuilder({
    spawn: () => child,
    createWriteStream: (() => {
      const output = new PassThrough()
      outputs.push(output)
      return output
    }) as unknown as typeof createWriteStream,
    ...(remove ? { remove } : {}),
  } as never)
}

function request(root: string) {
  return {
    projectRoot: root,
    stagingRoot: join(root, '.staging', 'fake'),
    sourcePath: join(root, 'source.wav'),
    audioSourceId: SOURCE_ID,
    sourceSha256: 'c'.repeat(64),
    metadata: {
      durationSeconds: 1,
      sampleRate: 48_000,
      channels: 1,
      codec: 'pcm_s16le',
      bitrateKbps: 768,
    },
    processingSampleRate: 48_000 as const,
  }
}

describe('FfmpegAudioSourceCacheBuilder', () => {
  it('does not miss a signal that was aborted before listener registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-pre-abort-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const controller = new AbortController()
    controller.abort()
    const building = fakeBuilder(child, outputs).build(request(root), controller.signal)
    await expect(building).rejects.toMatchObject({ name: 'AbortError' })
    expect(outputs).toHaveLength(0)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('retains only the final 4096 bytes of FFmpeg diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-tail-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const building = fakeBuilder(child, outputs).build(request(root), new AbortController().signal)
    await vi.waitFor(() => expect(outputs).toHaveLength(4))
    child.stderr.write(Buffer.alloc(5000, 'a'))
    child.stderr.end('TAIL-MARKER')
    child.stdout.end()
    child.emit('close', 1)

    const error = (await building.catch((reason: Error) => reason)) as Error
    const diagnostic = error.message.replace('FFmpeg cache decode failed: ', '')
    expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(4096)
    expect(diagnostic).toMatch(/TAIL-MARKER$/)
  })

  it('keeps re-encoded multibyte and malformed diagnostic text within 4096 bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-utf8-tail-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const building = fakeBuilder(child, outputs).build(request(root), new AbortController().signal)
    await vi.waitFor(() => expect(outputs).toHaveLength(4))
    child.stderr.end(
      Buffer.concat([
        Buffer.from('😀'.repeat(1100)),
        Buffer.from([0x80, 0x80, 0x80]),
        Buffer.from('END'),
      ]),
    )
    child.stdout.end()
    child.emit('close', 1)

    const error = (await building.catch((reason: Error) => reason)) as Error
    const diagnostic = error.message.replace('FFmpeg cache decode failed: ', '')
    expect(Buffer.byteLength(diagnostic, 'utf8')).toBeLessThanOrEqual(4096)
    expect(diagnostic).toMatch(/END$/)
  })

  it('routes a child error through kill, reap, stream close, and cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-child-error-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const stagingRoot = request(root).stagingRoot
    const building = fakeBuilder(child, outputs).build(request(root), new AbortController().signal)
    await vi.waitFor(() => expect(outputs).toHaveLength(4))
    child.on('error', () => {})

    child.emit('error', new Error('child spawn failed'))
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
    child.stdout.end()
    child.stderr.end()
    child.emit('close', null, 'SIGKILL')

    await expect(building).rejects.toThrow('child spawn failed')
    expect(outputs.every((output) => output.destroyed)).toBe(true)
    await expect(stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([0, 1, 2, 3])(
    'routes writer %i failure through the same centralized teardown',
    async (writerIndex) => {
      const root = await mkdtemp(join(tmpdir(), `redencut-builder-writer-${writerIndex}-`))
      const child = new FakeChild()
      const outputs: PassThrough[] = []
      const building = fakeBuilder(child, outputs).build(
        request(root),
        new AbortController().signal,
      )
      await vi.waitFor(() => expect(outputs).toHaveLength(4))
      outputs[writerIndex].on('error', () => {})

      outputs[writerIndex].destroy(new Error(`writer ${writerIndex} failed`))
      await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))
      child.stdout.end()
      child.stderr.end()
      child.emit('close', null, 'SIGKILL')

      await expect(building).rejects.toThrow(`writer ${writerIndex} failed`)
      expect(outputs.every((output) => output.destroyed)).toBe(true)
    },
  )

  it('kills once, reaps, closes streams, and only then removes staging on stream failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-failure-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const stagingRoot = request(root).stagingRoot
    const building = fakeBuilder(child, outputs).build(request(root), new AbortController().signal)
    await vi.waitFor(() => expect(outputs).toHaveLength(4))
    child.stdout.destroy(new Error('decode stream failed'))
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledTimes(1))

    let settled = false
    void building.catch(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await expect(stat(stagingRoot)).resolves.toBeDefined()

    child.stderr.end()
    child.emit('close', 1)
    await expect(building).rejects.toThrow('decode stream failed')
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(child.stdout.destroyed).toBe(true)
    expect(child.stderr.destroyed).toBe(true)
    expect(outputs.every((output) => output.destroyed)).toBe(true)
    await expect(stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('awaits delayed close before acknowledging abort cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-abort-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const controller = new AbortController()
    const stagingRoot = request(root).stagingRoot
    const building = fakeBuilder(child, outputs).build(request(root), controller.signal)
    await vi.waitFor(() => expect(outputs).toHaveLength(4))

    controller.abort()
    expect(child.kill).toHaveBeenCalledTimes(1)
    child.stdout.end()
    await Promise.resolve()
    await expect(stat(stagingRoot)).resolves.toBeDefined()

    child.stderr.end()
    child.emit('close', null, 'SIGKILL')
    await expect(building).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(outputs.every((output) => output.destroyed)).toBe(true)
    await expect(stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('aggregates abort and staging cleanup failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-builder-cleanup-error-'))
    const child = new FakeChild()
    const outputs: PassThrough[] = []
    const controller = new AbortController()
    const cleanupError = new Error('staging cleanup failed')
    const remove = vi.fn(async () => {
      throw cleanupError
    })
    const building = fakeBuilder(child, outputs, remove).build(request(root), controller.signal)
    await vi.waitFor(() => expect(outputs).toHaveLength(4))

    controller.abort()
    child.stdout.end()
    child.stderr.end()
    child.emit('close', null, 'SIGKILL')

    const error = (await building.catch((reason: AggregateError) => reason)) as AggregateError
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.errors).toEqual([expect.objectContaining({ name: 'AbortError' }), cleanupError])
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
