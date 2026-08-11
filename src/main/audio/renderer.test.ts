import { describe, it, expect } from 'vitest'
import { buildRenderArgs } from './renderer'
import type { ProjectFile, Track } from '@shared/project.types'

// Minimal project factory — shape must match actual ProjectFile schema
function makeProject(
  clips: {
    sfIdx: number // index into sourceFiles
    sourceStart: number
    sourceEnd: number
    outputStart: number
    muted?: boolean
  }[],
): ProjectFile {
  const sourceFiles = [
    { id: '/tmp/a.mp3', filePath: '/tmp/a.mp3', duration: 30 },
    { id: '/tmp/b.mp3', filePath: '/tmp/b.mp3', duration: 30 },
  ]
  const trackClips = clips.map((c, i) => ({
    id: `clip-${i}`,
    trackId: 'track-0',
    sourceFileId: sourceFiles[c.sfIdx].id,
    sourceStart: c.sourceStart,
    sourceEnd: c.sourceEnd,
    outputStart: c.outputStart,
    gain: 1,
    muted: c.muted ?? false,
    effects: [],
  }))
  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: { file: '/tmp/a.mp3', sampleRate: 44100, channels: 2, durationSeconds: 30 },
    edits: [],
    adjustments: [],
    markers: [],
    export: { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48000 },
    pluginData: {},
    sourceFiles,
    tracks: [
      {
        id: 'track-0',
        name: 'Voice',
        clips: trackClips,
        volume: 1,
        muted: false,
        solo: false,
        color: '#4f46e5',
        effects: [],
      },
    ],
  } as unknown as ProjectFile
}

describe('buildRenderArgs', () => {
  it('returns ffmpeg args array including -filter_complex, -map, and output path', () => {
    const project = makeProject([{ sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 }])
    const args = buildRenderArgs(project, '/tmp/out.mp3')
    expect(args).toContain('-filter_complex')
    expect(args).toContain('-map')
    expect(args[args.length - 1]).toBe('/tmp/out.mp3')
  })

  it('excludes muted clips', () => {
    const project = makeProject([
      { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
      { sfIdx: 0, sourceStart: 5, sourceEnd: 10, outputStart: 5, muted: true },
      { sfIdx: 0, sourceStart: 10, sourceEnd: 15, outputStart: 10 },
    ])
    const args = buildRenderArgs(project, '/tmp/out.mp3')
    const fc = args[args.indexOf('-filter_complex') + 1]
    // 2 non-muted clips → concat n=2
    expect(fc).toContain('concat=n=2')
  })

  it('skips fully-muted tracks and does not include them in amix', () => {
    const project = makeProject([{ sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 }])
    // Manually add a second track with all muted clips
    const mutedTrack: Track = {
      id: 'track-1',
      name: 'Music',
      clips: [
        {
          id: 'clip-m',
          trackId: 'track-1',
          sourceFileId: '/tmp/b.mp3',
          sourceStart: 0,
          sourceEnd: 5,
          outputStart: 0,
          gain: 1,
          muted: true,
          effects: [],
        },
      ],
      volume: 1,
      muted: false,
      solo: false,
      color: '#10b981',
      effects: [],
    }
    project.tracks.push(mutedTrack)
    const args = buildRenderArgs(project, '/tmp/out.mp3')
    const fc = args[args.indexOf('-filter_complex') + 1]
    // Only 1 active track — no amix=inputs=2, and -map must be present
    expect(fc).not.toContain('amix=inputs=2')
    expect(args).toContain('-map')
    expect(fc.length).toBeGreaterThan(0)
  })

  it('throws when all clips are muted', () => {
    const project = makeProject([
      { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0, muted: true },
    ])
    expect(() => buildRenderArgs(project, '/tmp/out.mp3')).toThrow('No non-muted clips')
  })

  it('uses correct FFmpeg input index for clips from a second source file', () => {
    const project = makeProject([
      { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
      { sfIdx: 1, sourceStart: 0, sourceEnd: 5, outputStart: 5 },
    ])
    const args = buildRenderArgs(project, '/tmp/out.mp3')
    // Both source files should appear as -i inputs
    const iIndices: number[] = []
    args.forEach((a, i) => {
      if (a === '-i') iIndices.push(i + 1)
    })
    expect(iIndices).toHaveLength(2)
    const fc = args[args.indexOf('-filter_complex') + 1]
    // Second clip references input 1
    expect(fc).toContain('[1:a]')
  })
})
