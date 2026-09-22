import { describe, expect, it } from 'vitest'
import { ProjectFileSchema } from './ProjectTypes'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000'
const ANALYSIS_REVISION_ID = '550e8400-e29b-41d4-a716-446655440001'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- malformed schema fixtures intentionally bypass branded domain types
function managedProject(): any {
  return {
    version: 2,
    createdAt: '2026-08-15T00:00:00.000Z',
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [
      {
        id: SOURCE_ID,
        displayName: 'episode.mp3',
        location: { mode: 'copy', path: `media/${SOURCE_ID}/episode.mp3` },
        fingerprint: { byteLength: 1234, modifiedTimeMs: 1000, sha256: 'a'.repeat(64) },
        metadata: {
          durationSeconds: 60,
          sampleRate: 44_100,
          channels: 2,
          codec: 'mp3',
          bitrateKbps: 192,
        },
      },
    ],
    speechArtifacts: [],
    speakerLabelOverrides: [],
    tracks: [
      {
        id: 'track-1',
        name: 'Track 1',
        clips: [
          {
            id: 'clip-1',
            trackId: 'track-1',
            audioSourceId: SOURCE_ID,
            sourceStart: 0,
            sourceEnd: 60,
            outputStart: 0,
          },
          {
            id: 'clip-2',
            trackId: 'track-1',
            audioSourceId: SOURCE_ID,
            sourceStart: 10,
            sourceEnd: 20,
            outputStart: 70,
          },
        ],
      },
    ],
  }
}

describe('ProjectFileSchema', () => {
  it('parses the first published managed-package schema and applies defaults', () => {
    const project = ProjectFileSchema.parse(managedProject())

    expect(project.version).toBe(4)
    expect(project.audioSettings.processingSampleRate).toBe(48_000)
    expect(project.tracks[0].clips.map((clip) => clip.audioSourceId)).toEqual([
      SOURCE_ID,
      SOURCE_ID,
    ])
    expect(project.export).toEqual({
      targetLUFS: -16,
      truePeakDbTP: -1.5,
      format: 'mp3',
      sampleRate: 48_000,
    })
  })

  it('rejects the unpublished path-identified project shape', () => {
    expect(() =>
      ProjectFileSchema.parse({
        version: 1,
        createdAt: '2026-08-11T00:00:00.000Z',
        source: { file: '/tmp/episode.mp3', sampleRate: 44_100, channels: 2, durationSeconds: 60 },
      }),
    ).toThrow()
  })

  it('rejects the former version-1 project schema without a compatibility adapter', () => {
    expect(() => ProjectFileSchema.parse({ ...managedProject(), version: 1 })).toThrow()
  })

  it.each(['legacy', 'content-addressed'])(
    'accepts a %s speech artifact reference bound to its source and revision',
    (kind) => {
      const project = managedProject()
      project.speechArtifacts.push({
        audioSourceId: SOURCE_ID,
        analysisRevisionId: ANALYSIS_REVISION_ID,
        sourceFingerprint: project.audioSources[0].fingerprint,
        artifactPath: `speech/${SOURCE_ID}/revision-${ANALYSIS_REVISION_ID}${kind === 'content-addressed' ? `-${'b'.repeat(64)}` : ''}.json`,
        artifactSha256: 'b'.repeat(64),
        artifactByteLength: 4096,
        artifactSchemaVersion: 1,
        summary: { transcriptUnitCount: 12, acousticEditUnitCount: 8, speakerCount: 2 },
      })

      expect(ProjectFileSchema.parse(project).speechArtifacts).toHaveLength(1)
    },
  )

  it('rejects a speech artifact path that does not match its stable IDs', () => {
    const project = managedProject()
    project.speechArtifacts.push({
      audioSourceId: SOURCE_ID,
      analysisRevisionId: ANALYSIS_REVISION_ID,
      sourceFingerprint: project.audioSources[0].fingerprint,
      artifactPath: 'speech/friendly-name/latest.json',
      artifactSha256: 'b'.repeat(64),
      artifactByteLength: 4096,
      artifactSchemaVersion: 1,
      summary: { transcriptUnitCount: 12, acousticEditUnitCount: 8, speakerCount: 2 },
    })

    expect(() => ProjectFileSchema.parse(project)).toThrow('source and analysis revision')
  })

  it.each(['../episode.mp3', '/tmp/episode.mp3', 'media\\episode.mp3', './episode.mp3'])(
    'rejects unsafe copied-media path %s',
    (path) => {
      const project = managedProject()
      project.audioSources[0].location.path = path
      expect(() => ProjectFileSchema.parse(project)).toThrow()
    },
  )

  it('requires reference-mode media to use an absolute external path', () => {
    const project = managedProject()
    project.audioSources[0].location = { mode: 'reference', path: 'relative/episode.mp3' }
    expect(() => ProjectFileSchema.parse(project)).toThrow()
    project.audioSources[0].location = { mode: 'reference', path: '/Volumes/Audio/episode.mp3' }
    expect(ProjectFileSchema.parse(project).audioSources[0].location.mode).toBe('reference')
  })

  it('requires copied media to live under its source-specific managed directory', () => {
    const project = managedProject()
    project.audioSources[0].location.path = 'media/another-source/episode.mp3'
    expect(() => ProjectFileSchema.parse(project)).toThrow('source-specific media directory')
  })

  it('rejects dangling source identities and clip ranges outside source duration', () => {
    const dangling = managedProject()
    dangling.tracks[0].clips[0].audioSourceId = '00000000-0000-4000-8000-000000000099'
    expect(() => ProjectFileSchema.parse(dangling)).toThrow('unknown AudioSource')

    const outside = managedProject()
    outside.tracks[0].clips[0].sourceEnd = 61
    expect(() => ProjectFileSchema.parse(outside)).toThrow('source range')
  })
})

describe('Mix source relationships', () => {
  const linked = () => {
    const project = managedProject()
    project.version = 3
    project.tracks.push({
      ...project.tracks[0],
      id: 'stem',
      clips: [{ ...project.tracks[0].clips[0], id: 'stem-clip', trackId: 'stem' }],
    })
    project.tracks[0].mixLink = { stemTrackIds: ['stem'] }
    project.tracks[0].clips[0].sourceOverrides = [
      { id: 'override', sourceStart: 2, sourceEnd: 4, stemTrackIds: ['stem'] },
    ]
    return project
  }
  it('retains source relationships in version 3', () => {
    expect(ProjectFileSchema.parse(linked()).tracks[0].mixLink).toEqual({ stemTrackIds: ['stem'] })
  })
  it.each([
    'missing',
    'self',
    'nested',
    'overlap',
    'empty',
    'duplicate-track',
    'duplicate-clip',
    'unlinked',
    'duplicate-owner',
    'duplicate-override',
    'outside-source',
  ])('rejects invalid relationship %s', (kind) => {
    const p = linked()
    if (kind === 'outside-source') p.tracks[0].clips[0].sourceOverrides[0].sourceEnd = 61
    if (kind === 'missing') p.tracks[0].mixLink.stemTrackIds = ['missing']
    if (kind === 'self') p.tracks[0].mixLink.stemTrackIds = ['track-1']
    if (kind === 'nested') p.tracks[1].mixLink = { stemTrackIds: ['track-1'] }
    if (kind === 'overlap')
      p.tracks[0].clips[0].sourceOverrides.push({
        id: 'overlap',
        sourceStart: 3,
        sourceEnd: 5,
        stemTrackIds: ['stem'],
      })
    if (kind === 'empty') p.tracks[0].clips[0].sourceOverrides[0].stemTrackIds = []
    if (kind === 'duplicate-track') p.tracks.push({ ...p.tracks[1], clips: [] })
    if (kind === 'duplicate-clip') p.tracks[1].clips[0].id = 'clip-1'
    if (kind === 'unlinked') delete p.tracks[0].mixLink
    if (kind === 'duplicate-owner') p.tracks.push({ ...p.tracks[0], id: 'another', clips: [] })
    if (kind === 'duplicate-override')
      p.tracks[0].clips[0].sourceOverrides.push({
        id: 'override',
        sourceStart: 5,
        sourceEnd: 6,
        stemTrackIds: ['stem'],
      })
    expect(ProjectFileSchema.safeParse(p).success).toBe(false)
  })
  it('round-trips hidden child topology and rejects stale parent and child ownership', () => {
    const project = linked()
    project.tracks[0].clips[0].sourceEnd = 4
    const segment = {
      masterClipId: 'clip-1',
      masterSourceStart: 4,
      clip: { ...project.tracks[1].clips[0], sourceStart: 4, sourceEnd: 10, outputStart: 4 },
    }
    project.tracks[0].mixLink.hiddenSegments = [segment]
    const restored = ProjectFileSchema.parse(JSON.parse(JSON.stringify(project)))
    expect(restored.tracks[0].mixLink?.hiddenSegments?.[0].clip.sourceEnd).toBe(10)
    for (const change of [
      { masterClipId: 'missing' },
      { clip: { ...segment.clip, trackId: 'missing' } },
      { clip: { ...segment.clip, sourceEnd: 61 } },
      { masterSourceStart: 2 },
    ]) {
      project.tracks[0].mixLink.hiddenSegments = [{ ...segment, ...change }]
      expect(ProjectFileSchema.safeParse(project).success).toBe(false)
    }
  })
  it('does not silently accept new relationships advertised as version 2', () => {
    const p = linked()
    p.version = 2
    expect(ProjectFileSchema.safeParse(p).success).toBe(false)
  })
})
