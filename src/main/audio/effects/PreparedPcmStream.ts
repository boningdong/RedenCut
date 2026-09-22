import { createReadStream } from 'node:fs'
import { open, rm, type FileHandle } from 'node:fs/promises'
import type { NormalizeParams } from '../../../shared/TrackEffects'
import type { PreparedAudioProgress } from '../../../shared/PreparedAudioTypes'
import { AutoLevelAnalyzer } from './AutoLevelPcm'
import { PreparedWaveform } from './PreparedWaveform'

/** Stdout may split a Float32 sample or interleaved frame across arbitrary chunks. */
async function* alignedFrames(source: AsyncIterable<Buffer>, channels: number) {
  const stride = channels * 4
  let remainder = Buffer.alloc(0)
  for await (const chunk of source) {
    const bytes = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
    const length = bytes.length - (bytes.length % stride)
    if (length) yield bytes.subarray(0, length)
    remainder = Buffer.from(bytes.subarray(length))
  }
  if (remainder.length) throw new Error('Unaligned prepared PCM')
}

async function writeAll(file: FileHandle, bytes: Buffer, signal: AbortSignal): Promise<void> {
  let offset = 0
  while (offset < bytes.length) {
    signal.throwIfAborted()
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset)
    if (!bytesWritten) throw new Error('Prepared PCM write failed')
    offset += bytesWritten
  }
}

/** Backpressure bounds PCM memory; the final output and waveform share the same pass. */
export async function preparePcmStream(
  source: AsyncIterable<Buffer>,
  path: string,
  channels: number,
  frameCount: number,
  normalize: NormalizeParams | undefined,
  signal: AbortSignal,
  onProgress?: (progress: PreparedAudioProgress) => void,
): Promise<PreparedWaveform> {
  const dryPath = `${path}.dry`
  const analyzer = normalize ? new AutoLevelAnalyzer(channels, frameCount) : undefined
  const builder = PreparedWaveform.builder(path, channels, frameCount, signal)
  const first = await open(analyzer ? dryPath : path, 'wx')
  let completed = 0
  try {
    onProgress?.({ phase: 'processing', completed: 0, total: frameCount })
    try {
      for await (const bytes of alignedFrames(source, channels)) {
        signal.throwIfAborted()
        completed += bytes.length / (channels * 4)
        if (completed > frameCount) throw new Error('Prepared PCM duration mismatch')
        if (analyzer) analyzer.append(bytes)
        else builder.append(bytes)
        await writeAll(first, bytes, signal)
        onProgress?.({ phase: 'processing', completed, total: frameCount })
      }
      signal.throwIfAborted()
      if (completed !== frameCount) throw new Error('Prepared PCM duration mismatch')
    } finally {
      await first.close()
    }
    if (analyzer && normalize) {
      const envelope = analyzer.finish(normalize)
      const output = await open(path, 'wx')
      completed = 0
      onProgress?.({ phase: 'waveform', completed, total: frameCount })
      try {
        for await (const bytes of alignedFrames(createReadStream(dryPath), channels)) {
          signal.throwIfAborted()
          envelope.apply(bytes, completed)
          builder.append(bytes)
          await writeAll(output, bytes, signal)
          completed += bytes.length / (channels * 4)
          onProgress?.({ phase: 'waveform', completed, total: frameCount })
        }
      } finally {
        await output.close()
      }
    }
    signal.throwIfAborted()
    return builder.finish()
  } catch (error) {
    await rm(path, { force: true })
    throw error
  } finally {
    await rm(dryPath, { force: true })
  }
}
