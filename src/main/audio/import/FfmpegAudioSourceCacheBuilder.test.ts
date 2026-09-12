import { mkdtemp, readFile, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { EventEmitter } from 'events'
import type { createWriteStream } from 'fs'
import { PassThrough } from 'stream'
import { promisify } from 'util'
import { describe, expect, it, vi } from 'vitest'
import type { AudioSourceId } from '../../../shared/project.types'
import { getFfmpegPath } from '../binaries'
import { FfmpegAudioSourceCacheBuilder } from './FfmpegAudioSourceCacheBuilder'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId
const execFileAsync = promisify(execFile)

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

function monoWav(frameCount: number): Buffer {
  const buffer = Buffer.alloc(44 + frameCount * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(48_000, 24)
  buffer.writeUInt32LE(96_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(frameCount * 2, 40)
  for (let frame = 0; frame < frameCount; frame++)
    buffer.writeInt16LE(frame % 2 ? 16_000 : -16_000, 44 + frame * 2)
  return buffer
}

describe('FfmpegAudioSourceCacheBuilder', () => {
  it('does not miss a signal that was aborted before listener registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-pre-abort-'))
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
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-tail-'))
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
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-utf8-tail-'))
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
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-child-error-'))
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
      const root = await mkdtemp(join(tmpdir(), `riffcut-builder-writer-${writerIndex}-`))
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
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-failure-'))
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
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-abort-'))
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
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-cleanup-error-'))
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

  it('publishes PCM, all waveform levels, and the manifest last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-'))
    const sourcePath = join(root, 'source.wav')
    await writeFile(sourcePath, monoWav(5000))
    const builder = new FfmpegAudioSourceCacheBuilder()

    const manifest = await builder.build(
      {
        projectRoot: root,
        stagingRoot: join(root, '.staging', 'source'),
        sourcePath,
        audioSourceId: SOURCE_ID,
        sourceSha256: 'a'.repeat(64),
        metadata: {
          durationSeconds: 5000 / 48_000,
          sampleRate: 48_000,
          channels: 1,
          codec: 'pcm_s16le',
          bitrateKbps: 768,
        },
        processingSampleRate: 48_000,
      },
      new AbortController().signal,
    )

    expect((await stat(join(root, manifest.pcm.file))).size).toBe(manifest.pcm.byteLength)
    expect(manifest.waveform.levels.map((level) => level.bucketCount)).toEqual([20, 2, 1])
    expect(
      JSON.parse(await readFile(join(root, 'cache', SOURCE_ID, 'manifest.json'), 'utf8')),
    ).toEqual(manifest)
  })

  it('decodes non-silent PCM near the end of an MP3 larger than the retired 256 KiB index window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'riffcut-builder-mp3-'))
    const sourcePath = join(root, 'long.mp3')
    await execFileAsync(getFfmpegPath(), [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=997:sample_rate=48000',
      '-t',
      '30',
      '-b:a',
      '192k',
      sourcePath,
    ])
    expect((await stat(sourcePath)).size).toBeGreaterThan(256 * 1024)

    const manifest = await new FfmpegAudioSourceCacheBuilder().build(
      {
        projectRoot: root,
        stagingRoot: join(root, '.staging', 'long'),
        sourcePath,
        audioSourceId: SOURCE_ID,
        sourceSha256: 'b'.repeat(64),
        metadata: {
          durationSeconds: 30,
          sampleRate: 48_000,
          channels: 1,
          codec: 'mp3',
          bitrateKbps: 192,
        },
        processingSampleRate: 48_000,
      },
      new AbortController().signal,
    )

    const pcm = await readFile(join(root, manifest.pcm.file))
    const tail = pcm.subarray(Math.max(0, pcm.byteLength - 4096))
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
    let maximum = 0
    for (let offset = 0; offset < tail.byteLength; offset += 4) {
      maximum = Math.max(maximum, Math.abs(view.getFloat32(offset, true)))
    }
    expect(maximum).toBeGreaterThan(0.01)
  }, 20_000)
})
