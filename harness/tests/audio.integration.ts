import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { AudioCapture, requireContainerAudio } from '../audio/AudioCapture'

const execute = promisify(execFile)

test('private container output captures silence and an audible signal then closes the recorder', async () => {
  requireContainerAudio()
  const directory = await mkdtemp(join(tmpdir(), 'redencut-audio-test-'))
  let capture: AudioCapture | undefined
  try {
    capture = await AudioCapture.start(directory, 'silence')
    await new Promise((resolve) => setTimeout(resolve, 700))
    const silent = await capture.stop()
    expect(await capture.stop()).toBe(silent)
    const { stdout: silence } = await execute(
      'ffmpeg',
      ['-v', 'error', '-i', silent, '-f', 's16le', '-'],
      { encoding: 'buffer' },
    )
    expect(silence.length).toBeGreaterThan(10_000)
    expect(silence.some((byte) => byte !== 0)).toBe(false)
    capture = await AudioCapture.start(directory, 'tone')
    const input = join(directory, 'input.wav')
    await execute('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      input,
    ])
    // paplay waits for the sink to drain; a muxer finishing its write is not playback completion.
    await execute('paplay', ['--device=redencut_test', input])
    const tone = await capture.stop()
    const { stdout: samples } = await execute(
      'ffmpeg',
      ['-v', 'error', '-i', tone, '-f', 's16le', '-'],
      { encoding: 'buffer' },
    )
    expect(samples.some((byte) => byte !== 0)).toBe(true)
    expect((await readFile(join(directory, 'tone.capture.log'), 'utf8')).length).toBeGreaterThan(0)
  } finally {
    await capture?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

test('capture refuses overlap and existing output, and releases ownership after failed startup', async () => {
  requireContainerAudio()
  const directory = await mkdtemp(join(tmpdir(), 'redencut-audio-failure-'))
  let first: AudioCapture | undefined
  let second: AudioCapture | undefined
  try {
    first = await AudioCapture.start(directory, 'first')
    await expect(
      AudioCapture.start(directory, 'second').then((capture) => {
        second = capture
      }),
    ).rejects.toThrow('AUDIO_CAPTURE_ALREADY_ACTIVE')
    await first.stop()
    await writeFile(join(directory, 'existing.wav'), 'owned-by-another-capture')
    await expect(AudioCapture.start(directory, 'existing')).rejects.toThrow('AUDIO_CAPTURE_EXITED')
    expect(await readFile(join(directory, 'existing.wav'), 'utf8')).toBe('owned-by-another-capture')
    second = await AudioCapture.start(directory, 'recovered')
    await second.stop()
  } finally {
    await first?.stop()
    await second?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
