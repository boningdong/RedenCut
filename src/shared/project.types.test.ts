import { describe, expect, it } from 'vitest'
import { ProjectFileSchema } from './project.types'

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

    expect(project.version).toBe(2)
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
