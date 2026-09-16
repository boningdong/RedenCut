import { z } from 'zod'
import {
  AudioSourceFingerprintSchema,
  AudioSourceIdSchema,
  ProjectRelativePathSchema,
  SHA256_PATTERN,
} from './source.types'
import { AnalysisRevisionIdSchema, SpeakerIdSchema } from './speech.types'

export {
  AudioSourceFingerprintSchema,
  AudioSourceIdSchema,
  ProjectRelativePathSchema,
} from './source.types'
export type { AudioSourceFingerprint, AudioSourceId, ProjectRelativePath } from './source.types'

export const AudioMetadataSchema = z
  .object({
    durationSeconds: z.number().nonnegative(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
    codec: z.string().min(1),
    bitrateKbps: z.number().nonnegative(),
  })
  .strict()
export type AudioMetadata = z.infer<typeof AudioMetadataSchema>

const AudioSourceLocationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('copy'), path: ProjectRelativePathSchema }).strict(),
  z
    .object({
      mode: z.literal('reference'),
      path: z
        .string()
        .refine(
          (value) =>
            value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'),
          'Expected an absolute external path',
        ),
    })
    .strict(),
])

export const AudioSourceSchema = z
  .object({
    id: AudioSourceIdSchema,
    displayName: z.string().min(1),
    location: AudioSourceLocationSchema,
    fingerprint: AudioSourceFingerprintSchema,
    metadata: AudioMetadataSchema,
  })
  .strict()
export type AudioSource = z.infer<typeof AudioSourceSchema>

const WordSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    start: z.number(),
    end: z.number(),
    confidence: z.number().optional(),
    speaker: z.string().optional(),
    muted: z.boolean().default(false),
    audioSourceId: AudioSourceIdSchema.optional(),
    trackId: z.string().optional(),
  })
  .strict()
export type Word = z.infer<typeof WordSchema>

export const TranscriptSchema = z
  .object({
    engine: z.string(),
    model: z.string().optional(),
    words: z.array(WordSchema),
    speakers: z.record(z.string(), z.object({ label: z.string() })).default({}),
  })
  .strict()
export type Transcript = z.infer<typeof TranscriptSchema>

const AdjustmentSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('gain'),
    start: z.number(),
    end: z.number(),
    valueDb: z.number(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('crossfade'),
    at: z.number(),
    durationMs: z.number().default(30),
  }),
])

const MarkerSchema = z.object({
  id: z.string(),
  time: z.number(),
  type: z.enum(['jump_cut', 'note', 'todo']),
  label: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  resolved: z.boolean().default(false),
})

const ExportSettingsSchema = z.object({
  targetLUFS: z.number().default(-16),
  truePeakDbTP: z.number().default(-1.5),
  format: z.enum(['mp3', 'wav', 'flac', 'aac']).default('mp3'),
  sampleRate: z.number().default(48_000),
})

const EffectSchema = z.object({
  id: z.string(),
  type: z.enum(['gain', 'eq', 'compressor', 'noise-reduction']),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.number()).default({}),
})

export const ClipRedactionSchema = z
  .object({
    id: z.string().min(1),
    sourceStart: z.number().finite().nonnegative(),
    sourceEnd: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((range) => range.sourceEnd > range.sourceStart, 'Redaction must have positive duration')
export type ClipRedaction = z.infer<typeof ClipRedactionSchema>

const ClipSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  audioSourceId: AudioSourceIdSchema,
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().nonnegative(),
  outputStart: z.number().nonnegative(),
  gain: z.number().default(1),
  muted: z.boolean().default(false),
  redactions: z.array(ClipRedactionSchema).optional(),
  effects: z.array(EffectSchema).default([]),
})
export type Clip = z.infer<typeof ClipSchema>

const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  clips: z.array(ClipSchema).default([]),
  volume: z.number().default(1),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  color: z.string().default('#4f46e5'),
  effects: z.array(EffectSchema).default([]),
})
export type Track = z.infer<typeof TrackSchema>

export const SpeechArtifactRefSchema = z
  .object({
    audioSourceId: AudioSourceIdSchema,
    analysisRevisionId: AnalysisRevisionIdSchema,
    sourceFingerprint: AudioSourceFingerprintSchema,
    artifactPath: ProjectRelativePathSchema,
    artifactSha256: z.string().regex(SHA256_PATTERN),
    artifactByteLength: z.number().int().positive(),
    artifactSchemaVersion: z.number().int().positive(),
    summary: z
      .object({
        transcriptUnitCount: z.number().int().nonnegative(),
        acousticEditUnitCount: z.number().int().nonnegative(),
        speakerCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
export type SpeechArtifactRef = z.infer<typeof SpeechArtifactRefSchema>

export const SpeakerLabelOverrideSchema = z
  .object({
    audioSourceId: AudioSourceIdSchema,
    analysisRevisionId: AnalysisRevisionIdSchema,
    speechArtifactSha256: z.string().regex(SHA256_PATTERN),
    speakerId: SpeakerIdSchema,
    displayName: z.string().trim().min(1),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict()
export type SpeakerLabelOverride = z.infer<typeof SpeakerLabelOverrideSchema>

export const ProjectFileSchema = z
  .object({
    version: z.literal(2),
    createdAt: z.string(),
    audioSettings: z.object({ processingSampleRate: z.literal(48_000) }).strict(),
    audioSources: z.array(AudioSourceSchema),
    speechArtifacts: z.array(SpeechArtifactRefSchema).default([]),
    speakerLabelOverrides: z.array(SpeakerLabelOverrideSchema).default([]),
    adjustments: z.array(AdjustmentSchema).default([]),
    markers: z.array(MarkerSchema).default([]),
    export: ExportSettingsSchema.prefault({}),
    pluginData: z.record(z.string(), z.unknown()).default({}),
    tracks: z.array(TrackSchema).default([]),
  })
  .strict()
  .superRefine((project, context) => {
    const sources = new Map(project.audioSources.map((source) => [source.id, source]))
    if (sources.size !== project.audioSources.length) {
      context.addIssue({
        code: 'custom',
        path: ['audioSources'],
        message: 'Duplicate AudioSourceId',
      })
    }
    project.audioSources.forEach((source, sourceIndex) => {
      if (
        source.location.mode === 'copy' &&
        !source.location.path.startsWith(`media/${source.id}/`)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['audioSources', sourceIndex, 'location', 'path'],
          message: 'Copied media must use its source-specific media directory',
        })
      }
    })
    project.tracks.forEach((track, trackIndex) => {
      track.clips.forEach((clip, clipIndex) => {
        const path = ['tracks', trackIndex, 'clips', clipIndex]
        const source = sources.get(clip.audioSourceId)
        if (!source) {
          context.addIssue({
            code: 'custom',
            path: [...path, 'audioSourceId'],
            message: 'Clip references unknown AudioSource',
          })
        } else if (
          clip.sourceEnd <= clip.sourceStart ||
          clip.sourceEnd > source.metadata.durationSeconds
        ) {
          context.addIssue({
            code: 'custom',
            path,
            message: 'Clip source range is outside AudioSource duration',
          })
        }
        if (clip.trackId !== track.id) {
          context.addIssue({
            code: 'custom',
            path: [...path, 'trackId'],
            message: 'Clip trackId does not match its track',
          })
        }
        const redactionIds = new Set<string>()
        clip.redactions?.forEach((redaction, index) => {
          if (
            redactionIds.has(redaction.id) ||
            (source && redaction.sourceEnd > source.metadata.durationSeconds)
          ) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'redactions', index],
              message:
                'Redactions require unique clip-local IDs and bounds within the audio source',
            })
          }
          redactionIds.add(redaction.id)
        })
      })
    })
    const speechArtifactKeys = new Set<string>()
    project.speechArtifacts.forEach((reference, referenceIndex) => {
      const source = sources.get(reference.audioSourceId)
      const key = `${reference.audioSourceId}:${reference.analysisRevisionId}`
      if (speechArtifactKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['speechArtifacts', referenceIndex],
          message: 'Only one speech artifact may exist for a source and analysis revision',
        })
      }
      speechArtifactKeys.add(key)
      if (!source) {
        context.addIssue({
          code: 'custom',
          path: ['speechArtifacts', referenceIndex, 'audioSourceId'],
          message: 'Speech artifact references unknown AudioSource',
        })
        return
      }
      if (JSON.stringify(reference.sourceFingerprint) !== JSON.stringify(source.fingerprint)) {
        context.addIssue({
          code: 'custom',
          path: ['speechArtifacts', referenceIndex, 'sourceFingerprint'],
          message: 'Speech artifact fingerprint does not match AudioSource',
        })
      }
      const expectedPath = `speech/${reference.audioSourceId}/revision-${reference.analysisRevisionId}.json`
      const contentAddressedPath = `speech/${reference.audioSourceId}/revision-${reference.analysisRevisionId}-${reference.artifactSha256}.json`
      if (
        reference.artifactPath !== expectedPath &&
        reference.artifactPath !== contentAddressedPath
      ) {
        context.addIssue({
          code: 'custom',
          path: ['speechArtifacts', referenceIndex, 'artifactPath'],
          message: 'Speech artifact path must identify its source and analysis revision',
        })
      }
    })
    const overrides = new Set<string>()
    project.speakerLabelOverrides.forEach((override, overrideIndex) => {
      const reference = project.speechArtifacts.find(
        (candidate) =>
          candidate.audioSourceId === override.audioSourceId &&
          candidate.analysisRevisionId === override.analysisRevisionId &&
          candidate.artifactSha256 === override.speechArtifactSha256,
      )
      if (!reference) {
        context.addIssue({
          code: 'custom',
          path: ['speakerLabelOverrides', overrideIndex],
          message: 'Speaker label override is not bound to the current speech artifact',
        })
      }
      const key = `${override.audioSourceId}:${override.analysisRevisionId}:${override.speakerId}`
      if (overrides.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['speakerLabelOverrides', overrideIndex],
          message: 'Duplicate speaker label override',
        })
      }
      overrides.add(key)
    })
  })
export type ProjectFile = z.infer<typeof ProjectFileSchema>

export function createEmptyProject(createdAt = new Date().toISOString()): ProjectFile {
  return ProjectFileSchema.parse({
    version: 2,
    createdAt,
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [],
    speechArtifacts: [],
    speakerLabelOverrides: [],
    tracks: [],
  })
}
