import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it } from 'vitest'
import { withSpeechAudio } from './prepareSpeechAudio'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

it('normalizes imported stereo PCM to a temporary 16k mono WAV and removes it after analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-test-'))
  roots.push(root)
  const path = join(root, 'audio.f32le')
  await writeFile(path, Buffer.alloc(4800 * 2 * 4))
  let prepared = ''
  const result = await withSpeechAudio(
    { path, sampleRate: 48000, channels: 2 },
    new AbortController().signal,
    async (wav) => {
      prepared = wav
      const bytes = await readFile(wav)
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
      expect(bytes.readUInt16LE(22)).toBe(1)
      expect(bytes.readUInt32LE(24)).toBe(16000)
      expect(bytes.readUInt16LE(34)).toBe(16)
      return 'published'
    },
  )
  expect(result).toBe('published')
  await expect(stat(prepared)).rejects.toThrow()
  expect((await stat(path)).size).toBe(4800 * 2 * 4)
})

it('cleans the prepared audio when analysis fails or is cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-test-'))
  roots.push(root)
  const path = join(root, 'audio.f32le')
  await writeFile(path, Buffer.alloc(480 * 4))
  const abort = new AbortController()
  let prepared = ''
  await expect(
    withSpeechAudio({ path, sampleRate: 48000, channels: 1 }, abort.signal, async (wav) => {
      prepared = wav
      abort.abort()
      abort.signal.throwIfAborted()
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  await expect(stat(prepared)).rejects.toThrow()
})
