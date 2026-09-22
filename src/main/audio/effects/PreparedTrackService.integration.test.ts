import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { AudioSource, AudioSourceId, Track } from '../../../shared/ProjectTypes'
import { buildAudioRenderPlan } from '../../../shared/audio/AudioRenderPlanBuilder'
import { NORMALIZE_DEFAULTS } from '../../../shared/TrackEffects'
import { getFfmpegPath } from '../../runtime/AppRuntimeLocator'
import { PreparedTrackService } from './PreparedTrackService'
import { compileFfmpegPlan } from '../export/FfmpegPlanCompiler'

it('levels alternating speakers after replacement mixing, matches export, and preserves original stereo PCM', async () => {
  const root = mkdtempSync(join(tmpdir(), 'effects-evidence-'))
  const sourcePath = join(root, 'speech.wav')
  const sourceId = '00000000-0000-4000-8000-000000000001' as AudioSourceId
  const service = new PreparedTrackService()
  try {
    const expression =
      'if(lt(mod(t,12),6),0.018,0.18)*(sin(2*PI*180*t)+0.5*sin(2*PI*360*t)+0.3*sin(2*PI*730*t))*(0.6+0.4*sin(2*PI*3*t)^2)'
    execFileSync(getFfmpegPath(), [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='${expression}|${expression}':s=48000:d=36`,
      '-c:a',
      'pcm_f32le',
      sourcePath,
    ])
    const original = readFileSync(sourcePath)
    const hash = createHash('sha256').update(original).digest('hex')
    const source = {
      id: sourceId,
      metadata: { channels: 2 },
      fingerprint: { sha256: hash },
    } as AudioSource
    const masterId = '00000000-0000-4000-8000-000000000002' as AudioSourceId
    const master: Track = {
      id: 'master',
      name: 'Mix',
      color: '#fff',
      volume: 1,
      muted: false,
      solo: false,
      effects: [{ id: 'normalize', type: 'normalize', enabled: true, params: NORMALIZE_DEFAULTS }],
      mixLink: { stemTrackIds: ['stem'] },
      clips: [
        {
          id: 'master-clip',
          trackId: 'master',
          audioSourceId: masterId,
          sourceStart: 0,
          sourceEnd: 36,
          outputStart: 0,
          gain: 1,
          muted: false,
          effects: [],
          sourceOverrides: [
            { id: 'replace', sourceStart: 0, sourceEnd: 36, stemTrackIds: ['stem'] },
          ],
        },
      ],
    }
    const stem: Track = {
      ...master,
      id: 'stem',
      name: 'Replacement',
      mixLink: undefined,
      volume: 0,
      gainDb: -24,
      clips: [
        {
          ...master.clips[0],
          id: 'stem-clip',
          trackId: 'stem',
          audioSourceId: sourceId,
          sourceOverrides: undefined,
        },
      ],
    }
    const plan = buildAudioRenderPlan([master, stem], 'edited')
    expect(plan.tracks).toHaveLength(1)
    expect(plan.tracks[0].contributions.every((c) => c.source.audioSourceId === sourceId)).toBe(
      true,
    )
    const prepared = await service.prepare(plan, 'edited', [source], async () => sourcePath)
    const loud = await service.read(prepared.handle, 9 * 48000, 16384)
    const quiet = await service.read(prepared.handle, 3 * 48000, 16384)
    const rms = (samples: Float32Array) =>
      Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    const gap = 20 * Math.log10(rms(loud.channels[0]) / rms(quiet.channels[0]))
    // Numeric evidence is retained in test output for the audio acceptance record.
    // eslint-disable-next-line no-console
    console.info(
      `Normalization evidence: original gap 20 dB; processed gap ${gap.toFixed(3)} dB; stereo ${prepared.channels}; frames ${prepared.frameCount}`,
    )
    expect(Math.abs(gap)).toBeLessThan(3)
    expect(quiet.channels[0].every(Number.isFinite)).toBe(true)
    expect(quiet.channels[0]).toEqual(quiet.channels[1])
    const graph = compileFfmpegPlan(plan, new Map([[sourceId, 0]]), new Map([[sourceId, 2]]))
    const exported = execFileSync(
      getFfmpegPath(),
      [
        '-v',
        'error',
        '-i',
        sourcePath,
        '-filter_complex',
        graph,
        '-map',
        '[export]',
        '-f',
        'f32le',
        '-c:a',
        'pcm_f32le',
        'pipe:1',
      ],
      { maxBuffer: 20_000_000 },
    )
    for (let i = 0; i < 16384; i++)
      expect(quiet.channels[0][i]).toBe(exported.readFloatLE((3 * 48000 + i) * 8))
    expect(createHash('sha256').update(readFileSync(sourcePath)).digest('hex')).toBe(hash)
    const cached = await service.prepare(
      { ...plan, tracks: [{ ...plan.tracks[0], gainDb: 6, volume: 0.5 }] },
      'edited',
      [source],
      async () => {
        throw new Error('should reuse')
      },
    )
    expect(cached.handle).toBe(prepared.handle)
    await expect(service.read(prepared.handle, 0, 16385)).rejects.toThrow('range')
  } finally {
    await service.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)

it('renders finite silence, rejects missing sources and failed FFmpeg, and invalidates replaced handles', async () => {
  const service = new PreparedTrackService()
  const base = {
    ...buildAudioRenderPlan([], 'timeline'),
    durationFrames: 48000,
    tracks: [{ trackId: 'silent', volume: 1, normalize: NORMALIZE_DEFAULTS, contributions: [] }],
  }
  try {
    const first = await service.prepare(base, 'timeline', [], async () => '')
    expect(
      (await service.read(first.handle, 0, 100)).channels[0].every((value) => value === 0),
    ).toBe(true)
    const changed = await service.prepare(
      { ...base, durationFrames: 24000 },
      'timeline',
      [],
      async () => '',
    )
    expect(changed.frameCount).toBe(24000)
    await expect(service.read(first.handle, 0, 100)).rejects.toThrow('Unknown')
    const id = '00000000-0000-4000-8000-000000000001' as AudioSourceId
    const invalid = {
      ...base,
      tracks: [
        {
          ...base.tracks[0],
          contributions: [
            {
              clipId: 'missing',
              source: { audioSourceId: id, sourceStartFrame: 0, frameCount: 48000 },
              outputStartFrame: 0,
              gain: 1,
              envelope: { kind: 'constant' as const },
            },
          ],
        },
      ],
    }
    await expect(service.prepare(invalid, 'timeline', [], async () => '')).rejects.toThrow(
      'Unknown normalization source',
    )
    await expect(
      service.prepare(
        invalid,
        'timeline',
        [{ id, metadata: { channels: 1 }, fingerprint: { sha256: 'missing' } } as AudioSource],
        async () => '/missing-source.wav',
      ),
    ).rejects.toThrow('Normalization failed')
  } finally {
    await service.dispose()
  }
  await expect(service.read('anything', 0, 1)).rejects.toMatchObject({ name: 'AbortError' })
}, 30_000)

it('cancels obsolete composition before processing and disposes pending preparation', async () => {
  const service = new PreparedTrackService()
  const id = '00000000-0000-4000-8000-000000000001' as AudioSourceId
  const source = { id, metadata: { channels: 1 }, fingerprint: { sha256: 'x' } } as AudioSource
  const plan = {
    ...buildAudioRenderPlan([], 'timeline'),
    durationFrames: 48000,
    tracks: [
      {
        trackId: 'track',
        volume: 1,
        normalize: NORMALIZE_DEFAULTS,
        contributions: [
          {
            clipId: 'clip',
            source: { audioSourceId: id, sourceStartFrame: 0, frameCount: 48000 },
            outputStartFrame: 0,
            gain: 1,
            envelope: { kind: 'constant' as const },
          },
        ],
      },
    ],
  }
  let resolve!: (path: string) => void
  const pending = service.prepare(
    plan,
    'timeline',
    [source],
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const observed = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  const replacement = service.prepare(
    { ...plan, tracks: [{ ...plan.tracks[0], contributions: [] }] },
    'timeline',
    [],
    async () => '',
  )
  resolve('/unused.wav')
  await observed
  const result = await replacement
  expect(result.frameCount).toBe(48000)
  await service.dispose()
}, 30_000)

it('normalizes mono identically in playback and export when another independent track is stereo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'effects-mono-stereo-'))
  const monoPath = join(root, 'mono.wav')
  const stereoPath = join(root, 'stereo.wav')
  const monoId = '00000000-0000-4000-8000-000000000001' as AudioSourceId
  const stereoId = '00000000-0000-4000-8000-000000000002' as AudioSourceId
  const service = new PreparedTrackService()
  try {
    execFileSync(getFfmpegPath(), [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=230:sample_rate=48000:duration=8',
      '-c:a',
      'pcm_f32le',
      monoPath,
    ])
    execFileSync(getFfmpegPath(), [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-t',
      '8',
      '-c:a',
      'pcm_f32le',
      stereoPath,
    ])
    const contribution = (audioSourceId: AudioSourceId) => ({
      clipId: audioSourceId,
      source: { audioSourceId, sourceStartFrame: 0, frameCount: 8 * 48000 },
      outputStartFrame: 0,
      gain: 1,
      envelope: { kind: 'constant' as const },
    })
    const normalized = {
      trackId: 'mono',
      volume: 1,
      normalize: NORMALIZE_DEFAULTS,
      contributions: [contribution(monoId)],
    }
    const plan = {
      ...buildAudioRenderPlan([], 'edited'),
      durationFrames: 8 * 48000,
      tracks: [
        normalized,
        { trackId: 'stereo', volume: 1, contributions: [contribution(stereoId)] },
      ],
    }
    const source = {
      id: monoId,
      metadata: { channels: 1 },
      fingerprint: { sha256: 'mono' },
    } as AudioSource
    const descriptor = await service.prepare(
      { ...plan, tracks: [normalized] },
      'edited',
      [source],
      async () => monoPath,
    )
    expect(descriptor.channels).toBe(1)
    const block = await service.read(descriptor.handle, 3 * 48000, 16384)
    const graph = compileFfmpegPlan(
      plan,
      new Map([
        [monoId, 0],
        [stereoId, 1],
      ]),
      new Map([
        [monoId, 1],
        [stereoId, 2],
      ]),
    )
    const exported = execFileSync(
      getFfmpegPath(),
      [
        '-v',
        'error',
        '-i',
        monoPath,
        '-i',
        stereoPath,
        '-filter_complex',
        graph,
        '-map',
        '[export]',
        '-f',
        'f32le',
        '-c:a',
        'pcm_f32le',
        'pipe:1',
      ],
      { maxBuffer: 4_000_000 },
    )
    let maximumDifference = 0
    for (let i = 0; i < 16384; i++) {
      maximumDifference = Math.max(
        maximumDifference,
        Math.abs(block.channels[0][i] - exported.readFloatLE((3 * 48000 + i) * 8)),
      )
      expect(exported.readFloatLE((3 * 48000 + i) * 8)).toBe(
        exported.readFloatLE((3 * 48000 + i) * 8 + 4),
      )
    }
    expect(maximumDifference).toBeLessThan(1e-7)
  } finally {
    await service.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
