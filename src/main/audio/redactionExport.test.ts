import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, expect, it } from 'vitest'
import {
  AudioSourceSchema,
  createEmptyProject,
  type AudioSourceId,
  type Clip,
  type Track,
} from '@shared/project.types'
import { getFfmpegPath } from '../runtime/AppRuntimeLocator'
import { buildRenderArgs } from './renderer'

const rate = 48_000
const root = mkdtempSync(join(tmpdir(), 'redencut-redaction-export-'))
const sourceId = '00000000-0000-4000-8000-000000000001' as AudioSourceId
const sourcePath = join(root, 'source.wav')
const samples = new Float32Array(rate * 6)
samples.fill(0.15, 0, rate * 2)
samples.fill(0.45, rate * 2, rate * 4)
samples.fill(-0.25, rate * 4)
writeFileSync(join(root, 'source.f32'), Buffer.from(samples.buffer))
execFileSync(getFfmpegPath(), [
  '-v',
  'error',
  '-f',
  'f32le',
  '-ar',
  String(rate),
  '-ac',
  '1',
  '-i',
  join(root, 'source.f32'),
  '-c:a',
  'pcm_f32le',
  sourcePath,
])
afterAll(() => rmSync(root, { recursive: true, force: true }))

function clip(start: number, end: number, outputStart = start, redacted = false): Clip {
  return {
    id: `${start}-${end}-${outputStart}`,
    trackId: 'a',
    audioSourceId: sourceId,
    sourceStart: start,
    sourceEnd: end,
    outputStart,
    muted: false,
    redactions: redacted ? [{ id: 'r', sourceStart: start, sourceEnd: end }] : [],
    gain: 1,
    effects: [],
  }
}
function track(clips: Clip[], muted = false): Track {
  return { id: 'a', name: 'A', color: '#fff', muted, solo: false, volume: 1, effects: [], clips }
}
function render(tracks: Track[]): Float32Array {
  const project = createEmptyProject(new Date(0).toISOString())
  project.audioSources = [
    AudioSourceSchema.parse({
      id: sourceId,
      displayName: 'source.wav',
      location: { mode: 'copy', path: 'media/source.wav' },
      fingerprint: { byteLength: 1, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
      metadata: {
        durationSeconds: 6,
        sampleRate: rate,
        channels: 1,
        codec: 'pcm_f32le',
        bitrateKbps: 1536,
      },
    }),
  ]
  project.tracks = tracks
  project.export.format = 'wav'
  const output = join(root, 'export.wav')
  const args = buildRenderArgs(project, new Map([[sourceId, sourcePath]]), output)
  // Bound a regression in padding as well as process lifetime.
  args.splice(args.length - 1, 0, '-fs', '10000000')
  execFileSync(getFfmpegPath(), ['-v', 'error', ...args], { timeout: 10000 })
  const raw = join(root, 'export.f32')
  execFileSync(getFfmpegPath(), [
    '-v',
    'error',
    '-y',
    '-i',
    output,
    '-f',
    'f32le',
    '-ac',
    '1',
    '-ar',
    String(rate),
    raw,
  ])
  const bytes = readFileSync(raw)
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
function at(audio: Float32Array, second: number) {
  return audio[Math.round(second * rate)]
}

it('actually removes redacted samples and duration from the exported file', () => {
  const audio = render([
    track([{ ...clip(0, 6), redactions: [{ id: 'r', sourceStart: 2, sourceEnd: 4 }] }]),
  ])
  expect(audio.length).toBe(4 * rate)
  expect(at(audio, 1)).toBeCloseTo(0.15, 3)
  expect(at(audio, 2)).toBeCloseTo(-0.25, 3)
  expect(at(audio, 3)).toBeCloseTo(-0.25, 3)
})
it('preserves retained overlapping audio and only compacts uncovered redaction', () => {
  const audio = render([
    track([clip(0, 2), clip(2, 4, 2, true), clip(4, 6)]),
    { ...track([clip(3, 4)]), id: 'b' },
  ])
  expect(audio.length).toBe(5 * rate)
  expect(at(audio, 2.5)).toBeCloseTo(0.45, 3)
  expect(at(audio, 3.5)).toBeCloseTo(-0.25, 3)
})
it('preserves natural gaps and ordinary track mute duration', () => {
  const gap = render([track([clip(0, 2), clip(4, 6)])])
  expect(gap.length).toBe(6 * rate)
  expect(at(gap, 3)).toBe(0)
  const muted = render([track([clip(0, 6)], true)])
  expect(muted.length).toBe(6 * rate)
  expect(muted.every((value) => value === 0)).toBe(true)
  const clipMuted = render([track([{ ...clip(0, 6), muted: true }])])
  expect(clipMuted.length).toBe(6 * rate)
  expect(clipMuted.every((value) => value === 0)).toBe(true)
})
it('removes trailing redaction while preserving a muted track tail', () => {
  const redacted = render([track([clip(0, 2), clip(2, 6, 2, true)])])
  expect(redacted.length).toBe(2 * rate)
  const mutedTail = render([track([clip(0, 2)]), { ...track([clip(0, 6)], true), id: 'b' }])
  expect(mutedTail.length).toBe(6 * rate)
  expect(at(mutedTail, 5)).toBe(0)
})

it('exports a three-clip timeline with a fractional-boundary natural gap', () => {
  const audio = render([track([clip(0, 1.337), clip(1.337, 4.001), clip(4.001, 6, 6.001)])])
  expect(audio.length).toBe(8 * rate)
  expect(at(audio, 5)).toBe(0)
  expect(at(audio, 7)).toBeCloseTo(-0.25, 3)
})
