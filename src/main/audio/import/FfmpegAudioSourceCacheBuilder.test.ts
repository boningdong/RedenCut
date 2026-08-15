import { mkdtemp, readFile, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { describe, expect, it } from 'vitest'
import type { AudioSourceId } from '../../../shared/project.types'
import { getFfmpegPath } from '../binaries'
import { FfmpegAudioSourceCacheBuilder } from './FfmpegAudioSourceCacheBuilder'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId
const execFileAsync = promisify(execFile)

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
  it('publishes PCM, all waveform levels, and the manifest last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podcut-builder-'))
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
    const root = await mkdtemp(join(tmpdir(), 'podcut-builder-mp3-'))
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
