import { describe, expect, it } from 'vitest'
import type { AudioSourceCacheDescriptor, WorkspaceDescriptor } from '../../shared/import.types'
import {
  AudioSourceSchema,
  ProjectFileSchema,
  type AudioSourceId,
  type ProjectFile,
} from '../../shared/project.types'
import type { ProjectDraft, WorkspaceToken } from '../../shared/session.types'
import { mergeProjectDraft, toRendererSession } from './sessionProjection'

const source = AudioSourceSchema.parse({
  id: '00000000-0000-4000-8000-000000000014',
  displayName: 'Private recording.mp3',
  location: { mode: 'reference', path: '/Users/example/Audio/Private recording.mp3' },
  fingerprint: {
    byteLength: 42,
    modifiedTimeMs: 1_700_000_000_000,
    sha256: 'a'.repeat(64),
  },
  metadata: {
    durationSeconds: 42,
    sampleRate: 44_100,
    channels: 2,
    codec: 'mp3',
    bitrateKbps: 192,
  },
})

const workspace: WorkspaceDescriptor = { kind: 'saved', displayName: 'Private', portable: false }
const descriptor: AudioSourceCacheDescriptor = {
  audioSourceId: source.id,
  sampleRate: 48_000,
  channels: 2,
  frameCount: 2_016_000,
  waveformLevels: [{ samplesPerBucket: 256, bucketCount: 7_875 }],
}
const token = 'session-token' as WorkspaceToken

function authoritativeProject(): ProjectFile {
  return ProjectFileSchema.parse({
    version: 2,
    createdAt: '2026-08-14T00:00:00.000Z',
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [source],
    speechArtifacts: [],
    speakerLabelOverrides: [],
    adjustments: [{ id: 'gain-1', type: 'gain', start: 0, end: 1, valueDb: -3 }],
    markers: [{ id: 'marker-1', time: 1, type: 'note', label: 'Keep' }],
    export: { format: 'wav', targetLUFS: -14, truePeakDbTP: -1, sampleRate: 48_000 },
    pluginData: { privatePluginState: { sourcePath: 'media/should-not-leak.mp3' } },
    tracks: [
      {
        id: 'track-1',
        name: 'Main',
        clips: [
          {
            id: 'clip-1',
            trackId: 'track-1',
            audioSourceId: source.id,
            sourceStart: 0,
            sourceEnd: 42,
            outputStart: 0,
          },
        ],
      },
    ],
  })
}

describe('toRendererSession', () => {
  it('projects a reference-mode project without persisted paths or main-only metadata', () => {
    const project = authoritativeProject()
    const session = toRendererSession(
      { project, descriptor: workspace, speechArtifacts: [] },
      token,
      4,
      [descriptor],
    )
    const serialized = JSON.stringify(session)

    expect(serialized).not.toContain('location')
    expect(serialized).not.toContain('path')
    expect(serialized).not.toContain('fingerprint')
    expect(serialized).not.toContain('a'.repeat(64))
    expect(serialized).not.toContain('createdAt')
    expect(serialized).not.toContain('pluginData')
    expect(serialized).not.toContain('media/should-not-leak.mp3')
    expect(session).toEqual({
      workspaceToken: token,
      revision: 4,
      workspace,
      sources: [
        {
          id: source.id,
          displayName: source.displayName,
          metadata: source.metadata,
          cache: descriptor,
        },
      ],
      draft: {
        tracks: project.tracks,
        export: project.export,
      },
      speechAnalyses: [],
    })
  })
})

describe('mergeProjectDraft', () => {
  it('cannot replace an authoritative reference location or fingerprint with forged renderer fields', () => {
    const forgedDraft = {
      tracks: authoritativeProject().tracks,
      export: authoritativeProject().export,
      audioSources: [
        {
          ...source,
          location: { mode: 'reference', path: '/tmp/forged.mp3' },
          fingerprint: { byteLength: 0, modifiedTimeMs: 0, sha256: 'b'.repeat(64) },
        },
      ],
    } as ProjectDraft

    const merged = mergeProjectDraft(authoritativeProject(), forgedDraft)

    expect(merged.audioSources).toEqual([source])
  })

  it('preserves main-owned fields while applying a valid renderer draft', () => {
    const project = authoritativeProject()
    const draft: ProjectDraft = {
      tracks: [{ ...project.tracks[0], name: 'Edited main' }],
      export: { ...project.export, format: 'flac' },
    }

    const merged = mergeProjectDraft(project, draft)

    expect(merged).toMatchObject({
      version: project.version,
      createdAt: project.createdAt,
      audioSettings: project.audioSettings,
      audioSources: project.audioSources,
      adjustments: project.adjustments,
      markers: project.markers,
      pluginData: project.pluginData,
      tracks: draft.tracks,
      export: draft.export,
    })
    expect(merged.speechArtifacts).toEqual(project.speechArtifacts)
  })

  it.each([
    {
      name: 'unknown audio source',
      draft: (project: ProjectFile): ProjectDraft => ({
        tracks: [
          {
            ...project.tracks[0],
            clips: [
              {
                ...project.tracks[0].clips[0],
                audioSourceId: '00000000-0000-4000-8000-000000000099' as AudioSourceId,
              },
            ],
          },
        ],
        export: project.export,
      }),
    },
    {
      name: 'clip outside source duration',
      draft: (project: ProjectFile): ProjectDraft => ({
        tracks: [
          {
            ...project.tracks[0],
            clips: [{ ...project.tracks[0].clips[0], sourceEnd: 43 }],
          },
        ],
        export: project.export,
      }),
    },
  ])('rejects a draft with $name', ({ draft }) => {
    expect(() => mergeProjectDraft(authoritativeProject(), draft(authoritativeProject()))).toThrow()
  })
})
