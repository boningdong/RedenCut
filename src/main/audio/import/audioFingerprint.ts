import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import type { AudioSource } from '../../../shared/ProjectTypes'

export type AudioFingerprint = AudioSource['fingerprint']

export async function fingerprintAudioFile(
  path: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<AudioFingerprint> {
  throwIfAborted(signal)
  const before = await stat(path)
  const hash = createHash('sha256')
  const stream = createReadStream(path, { signal })
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal)
      hash.update(chunk as Buffer)
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException('Audio fingerprint aborted', 'AbortError')
    throw error
  }
  throwIfAborted(signal)
  const after = await stat(path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error('Original audio changed while it was being read')
  return {
    byteLength: after.size,
    modifiedTimeMs: after.mtimeMs,
    sha256: hash.digest('hex'),
  }
}

export async function verifyAudioFingerprint(
  path: string,
  expected: AudioFingerprint,
  validation: 'quick' | 'full' = 'full',
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  throwIfAborted(signal)
  const info = await stat(path)
  if (
    validation === 'quick' &&
    info.size === expected.byteLength &&
    info.mtimeMs === expected.modifiedTimeMs
  )
    return
  const actual = await fingerprintAudioFile(path, signal)
  if (actual.sha256 !== expected.sha256) throw new Error('Original audio changed since import')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Audio fingerprint aborted', 'AbortError')
}
