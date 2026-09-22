import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AudioSourceId, Track } from '@shared/ProjectTypes'
import type { AudioRenderPlan } from '@shared/audio/AudioRenderPlan'
import { getFfmpegPath, getFfprobePath } from '../../runtime/AppRuntimeLocator'
// Cross-backend integration test intentionally compares the actual playback executor.
// eslint-disable-next-line no-restricted-imports
import { renderTrackBlock } from '../../../renderer/src/audio/TrackBlockRenderer'
import type { AudioSampleProvider } from '@shared/PlayerTypes'
import { buildAudioRenderPlan } from '@shared/audio/AudioRenderPlanBuilder'
import { compileFfmpegPlan } from './FfmpegPlanCompiler'

const sourceId = '00000000-0000-4000-8000-000000000001' as AudioSourceId

describe('managed FFmpeg sample parity', () => {
  it('normalizes the composite before manual gain and volume', () => {
    const plan = buildAudioRenderPlan([], 'edited')
    plan.tracks = [
      {
        trackId: 'mix',
        volume: 0.5,
        gainDb: 6,
        normalize: { targetLufs: -16, truePeakDbtp: -1.5, loudnessRange: 7 },
        contributions: [sourceId, 'replacement' as AudioSourceId].map((audioSourceId) => ({
          clipId: audioSourceId,
          source: { audioSourceId, sourceStartFrame: 0, frameCount: 48000 },
          outputStartFrame: 0,
          gain: 1,
          envelope: { kind: 'constant' as const },
        })),
      },
    ]
    const graph = compileFfmpegPlan(
      plan,
      new Map([
        [sourceId, 0],
        ['replacement', 1],
      ]),
    )
    expect(graph).toContain('amix=inputs=2:normalize=0:duration=longest,dynaudnorm=')
    expect(graph).toContain('aresample=48000,volume=1.9952623149688795,volume=0.5')
  })

  it('duplicates mono at unity when mixing with stereo', () => {
    const monoId = 'mono' as AudioSourceId
    const plan: AudioRenderPlan = {
      ...buildAudioRenderPlan([], 'edited'),
      sampleRate: 48000,
      durationFrames: 48,
      tracks: [
        {
          trackId: 'track',
          volume: 1,
          contributions: [sourceId, monoId].map((audioSourceId) => ({
            clipId: audioSourceId,
            source: { audioSourceId, sourceStartFrame: 0, frameCount: 48 },
            outputStartFrame: 0,
            gain: 1,
            envelope: { kind: 'constant' },
          })),
        },
      ],
    }
    const graph = compileFfmpegPlan(
      plan,
      new Map([
        [sourceId, 0],
        [monoId, 1],
      ]),
      new Map([
        [sourceId, 2],
        [monoId, 1],
      ]),
    )
    const output = execFileSync(getFfmpegPath(), [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.1|0.2:s=48000:d=0.01',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.3:s=48000:d=0.01',
      '-filter_complex',
      graph,
      '-map',
      '[export]',
      '-f',
      'f32le',
      '-c:a',
      'pcm_f32le',
      'pipe:1',
    ])
    expect(output.length).toBe(48 * 8)
    expect(output.readFloatLE(0)).toBeCloseTo(0.4, 6)
    expect(output.readFloatLE(4)).toBeCloseTo(0.5, 6)
  })

  it.each(['wav', 'flac'])(
    'keeps exactly 83040 frames in %s after resampling 44.1 kHz input',
    (format) => {
      const root = mkdtempSync(join(tmpdir(), 'crossfade-encoding-'))
      try {
        const plan: AudioRenderPlan = {
          ...buildAudioRenderPlan([], 'edited'),
          sampleRate: 48000,
          durationFrames: 83040,
          tracks: [
            {
              trackId: 'track',
              volume: 1,
              contributions: [
                {
                  clipId: 'clip',
                  source: { audioSourceId: sourceId, sourceStartFrame: 211, frameCount: 82000 },
                  outputStartFrame: 99,
                  gain: 1,
                  envelope: { kind: 'constant' },
                },
              ],
            },
          ],
        }
        const output = join(root, `out.${format}`)
        execFileSync(getFfmpegPath(), [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=397:sample_rate=44100:duration=2',
          '-filter_complex',
          compileFfmpegPlan(plan, new Map([[sourceId, 0]])),
          '-map',
          '[export]',
          '-c:a',
          format === 'wav' ? 'pcm_s16le' : 'flac',
          output,
        ])
        const probe = JSON.parse(
          execFileSync(
            getFfprobePath(),
            [
              '-v',
              'error',
              '-show_entries',
              'stream=sample_rate,duration_ts,time_base',
              '-of',
              'json',
              output,
            ],
            { encoding: 'utf8' },
          ),
        )
        expect(probe.streams[0]).toMatchObject({
          sample_rate: '48000',
          duration_ts: 83040,
          time_base: '1/48000',
        })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it.each(['linear', 'equal-power'] as const)(
    'matches stereo float contributions and absolute %s phase',
    async (curve) => {
      const root = mkdtempSync(join(tmpdir(), 'crossfade-parity-'))
      try {
        const frames = 5000
        const pcm = Buffer.alloc(frames * 8)
        for (let frame = 0; frame < frames; frame++) {
          pcm.writeFloatLE(Math.sin(frame / 13) * 0.6, frame * 8)
          pcm.writeFloatLE(Math.cos(frame / 17) * 0.3, frame * 8 + 4)
        }
        const input = join(root, 'source.f32')
        writeFileSync(input, pcm)
        // The in contribution begins mid-envelope, testing absolute phase after seek/slicing.
        const contributions = [
          {
            clipId: 'left',
            source: { audioSourceId: sourceId, sourceStartFrame: 211, frameCount: 1440 },
            outputStartFrame: 101,
            gain: 0.7,
            envelope: {
              kind: 'fade' as const,
              direction: 'out' as const,
              curve,
              startOutputFrame: 101,
              frameCount: 1440,
            },
          },
          {
            clipId: 'right',
            source: { audioSourceId: sourceId, sourceStartFrame: 2333, frameCount: 1200 },
            outputStartFrame: 341,
            gain: 0.4,
            envelope: {
              kind: 'fade' as const,
              direction: 'in' as const,
              curve,
              startOutputFrame: 101,
              frameCount: 1440,
            },
          },
        ]
        const plan: AudioRenderPlan = {
          ...buildAudioRenderPlan([], 'edited'),
          sampleRate: 48000,
          durationFrames: 1800,
          tracks: [{ trackId: 'track', volume: 0.8, contributions }],
        }
        const output = execFileSync(getFfmpegPath(), [
          '-v',
          'error',
          '-f',
          'f32le',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-i',
          input,
          '-filter_complex',
          compileFfmpegPlan(plan, new Map([[sourceId, 0]])),
          '-map',
          '[export]',
          '-f',
          'f32le',
          '-c:a',
          'pcm_f32le',
          'pipe:1',
        ])
        expect(output.length).toBe(plan.durationFrames * 8)
        const provider: AudioSampleProvider = {
          audioSourceId: sourceId,
          format: 'f32-planar',
          sampleRate: 48000,
          channels: 2,
          frameCount: frames,
          readFrames: async (startFrame, frameCount) => ({
            startFrame,
            frameCount,
            channels: [0, 1].map((channel) =>
              Float32Array.from({ length: frameCount }, (_, i) =>
                pcm.readFloatLE((startFrame + i) * 8 + channel * 4),
              ),
            ),
          }),
        }
        const providers = new Map([[sourceId, provider]])
        // Include a seek into the middle and a block boundary inside the envelope.
        for (const [start, count] of [
          [0, 1800],
          [527, 317],
          [844, 600],
        ]) {
          const preview = await renderTrackBlock(
            plan.tracks[0],
            start,
            count,
            providers,
            new AbortController().signal,
          )
          for (let i = 0; i < count; i++)
            for (let channel = 0; channel < 2; channel++) {
              expect(
                Math.abs(
                  preview[channel][i] * 0.8 - output.readFloatLE((start + i) * 8 + channel * 4),
                ),
              ).toBeLessThanOrEqual(1e-5)
            }
        }

        let maxError = 0
        for (let frame = 0; frame < plan.durationFrames; frame++) {
          for (let channel = 0; channel < 2; channel++) {
            let expected = 0
            for (const c of contributions) {
              const local = frame - c.outputStartFrame
              if (local < 0 || local >= c.source.frameCount) continue
              const u = Math.max(
                0,
                Math.min(1, (frame - c.envelope.startOutputFrame) / (c.envelope.frameCount - 1)),
              )
              const weight =
                curve === 'linear'
                  ? c.envelope.direction === 'in'
                    ? u
                    : 1 - u
                  : c.envelope.direction === 'in'
                    ? Math.sin((Math.PI * u) / 2)
                    : Math.cos((Math.PI * u) / 2)
              expected +=
                pcm.readFloatLE((c.source.sourceStartFrame + local) * 8 + channel * 4) *
                c.gain *
                weight *
                0.8
            }
            maxError = Math.max(
              maxError,
              Math.abs(output.readFloatLE(frame * 8 + channel * 4) - expected),
            )
          }
        }
        expect(maxError).toBeLessThanOrEqual(1e-5)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

it.each(['linear', 'equal-power'] as const)(
  'renders a one-second %s join against independent PCM math',
  async (curve) => {
    const tracks: Track[] = [
      {
        id: 't',
        name: 't',
        volume: 1,
        muted: false,
        solo: false,
        color: '',
        effects: [],
        clips: [
          {
            id: 'c',
            trackId: 't',
            audioSourceId: sourceId,
            sourceStart: 0,
            sourceEnd: 5,
            outputStart: 0,
            gain: 1,
            muted: false,
            effects: [],
            redactions: [
              {
                id: 'r',
                sourceStart: 2,
                sourceEnd: 3,
                crossfade: { enabled: true, durationMs: 1000, curve },
              },
            ],
          },
        ],
      },
    ]
    const root = mkdtempSync(join(tmpdir(), 'crossfade-one-second-'))
    try {
      const frames = 5 * 48000
      const input = Buffer.alloc(frames * 4)
      for (let i = 0; i < frames; i++)
        input.writeFloatLE(
          0.2 * Math.sin((2 * Math.PI * (i < 3 * 48000 ? 440 : 880) * i) / 48000),
          i * 4,
        )
      const path = join(root, 'input.f32')
      writeFileSync(path, input)
      const plan = buildAudioRenderPlan(tracks)
      const output = execFileSync(
        getFfmpegPath(),
        [
          '-v',
          'error',
          '-f',
          'f32le',
          '-ar',
          '48000',
          '-ac',
          '1',
          '-i',
          path,
          '-filter_complex',
          compileFfmpegPlan(plan, new Map([[sourceId, 0]])),
          '-map',
          '[export]',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      )
      expect(output.length).toBe(3 * 48000 * 4)
      const provider: AudioSampleProvider = {
        audioSourceId: sourceId,
        format: 'f32-planar',
        sampleRate: 48000,
        channels: 1,
        frameCount: frames,
        readFrames: async (startFrame, frameCount) => ({
          startFrame,
          frameCount,
          channels: [
            Float32Array.from({ length: frameCount }, (_, i) =>
              input.readFloatLE((startFrame + i) * 4),
            ),
          ],
        }),
      }
      let exportError = 0,
        playbackError = 0,
        hardCutDifference = 0
      for (let start = 0; start < 144000; start += 4096) {
        const count = Math.min(4096, 144000 - start)
        const block = await renderTrackBlock(
          plan.tracks[0],
          start,
          count,
          new Map([[sourceId, provider]]),
          new AbortController().signal,
        )
        for (let j = 0; j < count; j++) {
          const i = start + j
          let expected: number
          if (i < 48000) expected = input.readFloatLE(i * 4)
          else if (i >= 96000) expected = input.readFloatLE((i + 96000) * 4)
          else {
            const u = (i - 48000) / 47999
            const left = input.readFloatLE(i * 4),
              right = input.readFloatLE((i + 96000) * 4)
            expected =
              left * (curve === 'linear' ? 1 - u : Math.cos((Math.PI * u) / 2)) +
              right * (curve === 'linear' ? u : Math.sin((Math.PI * u) / 2))
            hardCutDifference = Math.max(hardCutDifference, Math.abs(expected - left))
          }
          for (let channel = 0; channel < block.length; channel++) {
            exportError = Math.max(exportError, Math.abs(output.readFloatLE(i * 4) - expected))
            playbackError = Math.max(playbackError, Math.abs(block[channel][j] - expected))
          }
        }
      }
      expect(exportError).toBeLessThan(1e-5)
      expect(playbackError).toBeLessThan(1e-5)
      expect(hardCutDifference).toBeGreaterThan(0.1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
