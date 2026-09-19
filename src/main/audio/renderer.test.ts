import { describe, expect, it } from 'vitest'
import {
  AudioSourceSchema,
  createEmptyProject,
  type ProjectFile,
  type Track,
} from '@shared/ProjectTypes'
import { buildRenderArgs } from './Renderer'

const SOURCE_A = AudioSourceSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'a.mp3',
  location: { mode: 'copy', path: 'media/a.mp3' },
  fingerprint: { byteLength: 1, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
  metadata: {
    durationSeconds: 30,
    sampleRate: 44_100,
    channels: 2,
    codec: 'mp3',
    bitrateKbps: 192,
  },
})
const SOURCE_B = AudioSourceSchema.parse({
  ...SOURCE_A,
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'b.mp3',
  location: { mode: 'reference', path: '/tmp/b.mp3' },
})

function makeProject(
  clips: {
    source: 0 | 1
    sourceStart: number
    sourceEnd: number
    outputStart: number
    muted?: boolean
    redacted?: boolean
  }[],
): ProjectFile {
  const project = createEmptyProject('2026-01-01T00:00:00.000Z')
  project.audioSources = [SOURCE_A, SOURCE_B]
  project.tracks = [
    {
      id: 'track-0',
      name: 'Voice',
      clips: clips.map((clip, index) => ({
        id: `clip-${index}`,
        trackId: 'track-0',
        audioSourceId: project.audioSources[clip.source].id,
        sourceStart: clip.sourceStart,
        sourceEnd: clip.sourceEnd,
        outputStart: clip.outputStart,
        gain: 1,
        muted: clip.muted ?? false,
        redactions: clip.redacted
          ? [{ id: 'r', sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd }]
          : [],
        effects: [],
      })),
      volume: 1,
      muted: false,
      solo: false,
      color: '#4f46e5',
      effects: [],
    },
  ]
  return project
}

const paths = new Map([
  [SOURCE_A.id, '/bundle/media/a.mp3'],
  [SOURCE_B.id, '/tmp/b.mp3'],
])

describe('buildRenderArgs', () => {
  it('maps managed source identities to main-resolved inputs', () => {
    const project = makeProject([
      { source: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
      { source: 1, sourceStart: 0, sourceEnd: 5, outputStart: 5 },
    ])
    const args = buildRenderArgs(project, paths, '/tmp/out.mp3')
    expect(args[0]).toBe('-y')
    expect(args.filter((arg) => arg === '-i')).toHaveLength(2)
    expect(args).toContain('/bundle/media/a.mp3')
    expect(args).toContain('/tmp/b.mp3')
    expect(args[args.length - 1]).toBe('/tmp/out.mp3')
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('[1:a]')
  })

  it('removes redacted clips and compacts retained output positions', () => {
    const project = makeProject([
      { source: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
      { source: 0, sourceStart: 5, sourceEnd: 10, outputStart: 5, redacted: true },
      { source: 0, sourceStart: 10, sourceEnd: 15, outputStart: 10 },
    ])
    const args = buildRenderArgs(project, paths, '/tmp/out.mp3')
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).not.toContain('atrim=start=5:end=10')
    expect(graph).toContain('adelay=240000S:all=1')
    expect(graph).toContain('amix=inputs=2')
  })

  it('skips fully-muted tracks', () => {
    const project = makeProject([{ source: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 }])
    const mutedTrack: Track = {
      id: 'track-1',
      name: 'Music',
      volume: 1,
      muted: false,
      solo: false,
      color: '#10b981',
      effects: [],
      clips: [
        {
          id: 'clip-m',
          trackId: 'track-1',
          audioSourceId: SOURCE_B.id,
          sourceStart: 0,
          sourceEnd: 5,
          outputStart: 0,
          gain: 1,
          muted: true,
          effects: [],
        },
      ],
    }
    project.tracks.push(mutedTrack)
    const args = buildRenderArgs(project, paths, '/tmp/out.mp3')
    expect(args[args.indexOf('-filter_complex') + 1]).not.toContain('amix=inputs=2')
  })

  it('throws when the whole timeline is redacted', () => {
    const project = makeProject([
      { source: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0, redacted: true },
    ])
    expect(() => buildRenderArgs(project, paths, '/tmp/out.mp3')).toThrow('No retained timeline')
  })

  it('throws when main has not resolved a referenced source', () => {
    const project = makeProject([{ source: 1, sourceStart: 0, sourceEnd: 5, outputStart: 0 }])
    expect(() => buildRenderArgs(project, new Map(), '/tmp/out.mp3')).toThrow(
      'Missing resolved path',
    )
  })

  it('applies clip gain, track volume, and solo routing', () => {
    const project = makeProject([{ source: 0, sourceStart: 0, sourceEnd: 5, outputStart: 2 }])
    project.tracks[0].clips[0].gain = 0.5
    project.tracks[0].volume = 0.25
    project.tracks[0].solo = true
    project.tracks.push({
      id: 'ignored',
      name: 'Ignored',
      volume: 1,
      muted: false,
      solo: false,
      color: '#fff',
      effects: [],
      clips: [{ ...project.tracks[0].clips[0], id: 'ignored-clip', trackId: 'ignored' }],
    })
    const graph = buildRenderArgs(project, paths, '/tmp/out.wav').join(' ')
    expect(graph).toContain('volume=0.5')
    expect(graph).toContain('adelay=96000S:all=1')
    expect(graph).toContain('volume=0.25')
    expect(graph).not.toContain('track1')
  })
})
