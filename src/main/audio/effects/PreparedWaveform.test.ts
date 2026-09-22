import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PreparedWaveform } from './PreparedWaveform'

it('preserves signed stereo extrema and global peak outside the requested window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prepared-waveform-'))
  try {
    const path = join(root, 'pcm')
    const samples = [0.25, -0.5, 0.125, -0.25, 0.75, -0.125, 0, -1]
    const bytes = Buffer.alloc(samples.length * 4)
    samples.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
    await writeFile(path, bytes)
    const waveform = await PreparedWaveform.load(path, 2, 4, new AbortController().signal)
    expect(await waveform.read(0, 2, 2)).toEqual({
      buckets: [
        { min: -0.5, max: 0.25 },
        { min: -0.25, max: 0.125 },
      ],
      peak: 1,
    })
    expect(await waveform.read(0, 4, 1)).toEqual({ buckets: [{ min: -1, max: 0.75 }], peak: 1 })
    for (const [start, end, target] of [
      [-1, 2, 1],
      [0, 5, 1],
      [2, 1, 1],
      [0, 4, 0],
      [0, 4, 4097],
      [0.5, 4, 2],
      [0, Infinity, 2],
    ])
      await expect(waveform.read(start, end, target)).rejects.toThrow('range')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('reads exact samples at high zoom without leaking neighboring peaks on long recordings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prepared-waveform-zoom-'))
  try {
    const path = join(root, 'pcm')
    const bytes = Buffer.alloc(131072 * 4)
    bytes.writeFloatLE(1, 0)
    bytes.writeFloatLE(-0.75, 3 * 4)
    await writeFile(path, bytes)
    const waveform = await PreparedWaveform.load(path, 1, 131072, new AbortController().signal)
    expect(await waveform.read(1, 3, 2)).toEqual({
      buckets: [
        { min: 0, max: 0 },
        { min: 0, max: 0 },
      ],
      peak: 1,
    })
    expect(await waveform.read(0, 4, 4)).toEqual({
      buckets: [
        { min: 1, max: 1 },
        { min: 0, max: 0 },
        { min: 0, max: 0 },
        { min: -0.75, max: -0.75 },
      ],
      peak: 1,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
