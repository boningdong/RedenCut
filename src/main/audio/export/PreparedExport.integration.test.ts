import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  createEmptyProject,
  type AudioSource,
  type AudioSourceId,
  type Track,
} from '../../../shared/ProjectTypes'
import { buildAudioRenderPlan } from '../../../shared/audio/AudioRenderPlanBuilder'
import { NORMALIZE_DEFAULTS } from '../../../shared/TrackEffects'
import { getFfmpegPath } from '../../runtime/AppRuntimeLocator'
import { PreparedTrackService } from '../effects/PreparedTrackService'
import { prepareAutoLevelExport } from './PreparedExport'

it('exports the prepared mono and stereo mix with gain and volume exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-export-parity-'))
  const preview = new PreparedTrackService()
  let prepared: Awaited<ReturnType<typeof prepareAutoLevelExport>> | undefined
  try {
    const sources = [1, 2].map((channels, index) => {
      const id = `00000000-0000-4000-8000-00000000000${index + 1}` as AudioSourceId
      const path = join(directory, `${index}.wav`)
      const expression =
        index === 0
          ? 'if(lt(t,4),0.02,0.2)*sin(2*PI*180*t)'
          : '0.035*sin(2*PI*260*t)|0.025*sin(2*PI*340*t)'
      execFileSync(getFfmpegPath(), [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `aevalsrc='${expression}':s=48000:d=8`,
        '-c:a',
        'pcm_f32le',
        path,
      ])
      return {
        id,
        metadata: { channels },
        fingerprint: { sha256: String(index) },
        path,
      } as AudioSource & { path: string }
    })
    const tracks: Track[] = sources.map((source, index) => ({
      id: `track${index}`,
      name: `Track ${index}`,
      color: '#fff',
      muted: false,
      solo: false,
      gainDb: -6,
      volume: index === 0 ? 0.5 : 0.3,
      effects:
        index === 0
          ? [{ id: 'auto-level', type: 'normalize', enabled: true, params: NORMALIZE_DEFAULTS }]
          : [],
      clips: [
        {
          id: `clip${index}`,
          trackId: `track${index}`,
          audioSourceId: source.id,
          sourceStart: 0,
          sourceEnd: 8,
          outputStart: 0,
          gain: 0.8,
          muted: false,
          effects: [],
        },
      ],
    }))
    const project = {
      ...createEmptyProject(),
      tracks,
      audioSources: sources,
      export: { format: 'wav' as const, targetLUFS: -16, truePeakDbTP: -1.5, sampleRate: 48000 },
    }
    const paths = new Map(sources.map((source) => [source.id, source.path]))
    prepared = await prepareAutoLevelExport(project, paths, new AbortController().signal)
    const outputPath = join(directory, 'export.wav')
    const args = prepared.args(outputPath)
    const temporaryInputs = args.flatMap((value, index) =>
      value === '-i' ? [args[index + 1]] : [],
    )
    expect(temporaryInputs).toHaveLength(2)
    expect(temporaryInputs.every(existsSync)).toBe(true)
    execFileSync(getFfmpegPath(), ['-v', 'error', ...args])
    const output = execFileSync(
      getFfmpegPath(),
      ['-v', 'error', '-i', outputPath, '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'],
      { maxBuffer: 4_000_000 },
    )
    expect(output.length).toBe(8 * 48000 * 2 * 4)
    const plan = buildAudioRenderPlan(tracks, 'edited')
    const descriptors = await Promise.all(
      plan.tracks.map((track) =>
        preview.prepare({ ...plan, tracks: [track] }, 'edited', sources, async (id) =>
          paths.get(id)!,
        ),
      ),
    )
    let maximumDifference = 0
    for (const start of [48000, 5 * 48000]) {
      const blocks = await Promise.all(
        descriptors.map((descriptor) => preview.read(descriptor.handle, start, 16384)),
      )
      for (let frame = 0; frame < 16384; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const expected = blocks.reduce(
            (sum, block, index) =>
              sum +
              block.channels[Math.min(channel, block.channels.length - 1)][frame] *
                tracks[index].volume *
                10 ** (tracks[index].gainDb! / 20),
            0,
          )
          maximumDifference = Math.max(
            maximumDifference,
            Math.abs(output.readFloatLE(((start + frame) * 2 + channel) * 4) - expected),
          )
        }
      }
    }
    expect(maximumDifference).toBeLessThanOrEqual(1 / 32768)
    await prepared.dispose()
    expect(temporaryInputs.some(existsSync)).toBe(false)
  } finally {
    await prepared?.dispose()
    await preview.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)

it('rejects already-cancelled export preparation without opening sources', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    prepareAutoLevelExport(createEmptyProject(), new Map(), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
})
