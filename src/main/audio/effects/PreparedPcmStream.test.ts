import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NORMALIZE_DEFAULTS } from '../../../shared/TrackEffects'
import type { PreparedAudioProgress } from '../../../shared/PreparedAudioTypes'
import { preparePcmStream } from './PreparedPcmStream'
import { AutoLevelAnalyzer } from './AutoLevelPcm'

async function* chunks(bytes: Buffer, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size)
    yield Buffer.from(bytes.subarray(offset, offset + size))
}

it('indexes final stereo PCM in the write pass despite split samples and frames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stream-pcm-'))
  try {
    const path = join(root, 'final')
    const samples = [0.25, -0.5, 0.125, -0.25, 0.75, -0.125, 0, -1]
    const bytes = Buffer.alloc(samples.length * 4)
    samples.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
    const progress: PreparedAudioProgress[] = []
    const waveform = await preparePcmStream(
      chunks(bytes, 3),
      path,
      2,
      4,
      undefined,
      new AbortController().signal,
      (value) => progress.push(value),
    )
    expect(await readFile(path)).toEqual(bytes)
    // Overview is available without rereading final PCM.
    await rm(path)
    expect(await waveform.read(0, 4, 1)).toEqual({ buckets: [{ min: -1, max: 0.75 }], peak: 1 })
    expect(progress.map((value) => value.completed)).toEqual([0, 1, 2, 3, 4])
    expect(progress.every((value) => value.total === 4)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('transforms chunks identically to the shared envelope and indexes transformed output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stream-level-'))
  try {
    const path = join(root, 'final')
    const frames = 24000
    const bytes = Buffer.alloc(frames * 4)
    for (let frame = 0; frame < frames; frame++)
      bytes.writeFloatLE((frame < 12000 ? 0.02 : 0.2) * Math.sin(frame / 10), frame * 4)
    const analyzer = new AutoLevelAnalyzer(1, frames)
    analyzer.append(bytes)
    const expected = Buffer.from(bytes)
    analyzer.finish(NORMALIZE_DEFAULTS).apply(expected, 0)
    const progress: PreparedAudioProgress[] = []
    const waveform = await preparePcmStream(
      chunks(bytes, 997),
      path,
      1,
      frames,
      NORMALIZE_DEFAULTS,
      new AbortController().signal,
      (value) => progress.push(value),
    )
    expect(await readFile(path)).toEqual(expected)
    expect(await readdir(root)).toEqual(['final'])
    const values = Array.from({ length: frames }, (_, i) => expected.readFloatLE(i * 4))
    expect(await waveform.read(0, frames, 1)).toEqual({
      buckets: [{ min: Math.min(...values), max: Math.max(...values) }],
      peak: Math.max(...values.map(Math.abs)),
    })
    expect(progress.filter((value) => value.phase === 'processing').at(-1)?.completed).toBe(frames)
    expect(progress.at(-1)).toEqual({ phase: 'waveform', completed: frames, total: frames })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['short', 'unaligned', 'nonfinite', 'cancel'] as const)(
  'removes incomplete output and dry artifacts after %s',
  async (failure) => {
    const root = await mkdtemp(join(tmpdir(), 'stream-failure-'))
    try {
      const bytes = Buffer.alloc(failure === 'unaligned' ? 17 : 16)
      if (failure === 'nonfinite') bytes.writeFloatLE(NaN, 0)
      const controller = new AbortController()
      await expect(
        preparePcmStream(
          chunks(bytes, 8),
          join(root, 'final'),
          1,
          failure === 'short' ? 5 : 4,
          NORMALIZE_DEFAULTS,
          controller.signal,
          (progress) => {
            if (failure === 'cancel' && progress.completed > 0) controller.abort()
          },
        ),
      ).rejects.toThrow()
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
