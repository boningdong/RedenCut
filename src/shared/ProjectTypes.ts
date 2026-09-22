import { z } from 'zod'
import { NormalizeEffectSchema } from './TrackEffects'
import { MixLinkSchema, SourceOverrideSchema } from './MixLinkTypes'
import { CrossfadeSettingsSchema } from './audio/CrossfadeTypes'
import { SpeakerIdentityCatalogSchema } from './SpeakerIdentityTypes'
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

const LegacyEffectSchema = z.object({
  id: z.string(),
  type: z.enum(['gain', 'eq', 'compressor', 'noise-reduction']),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), z.number()).default({}),
})

const EffectSchema = z.union([NormalizeEffectSchema, LegacyEffectSchema])

export const ClipRedactionSchema = z
  .object({
    id: z.string().min(1),
    sourceStart: z.number().finite().nonnegative(),
    sourceEnd: z.number().finite().nonnegative(),
    crossfade: CrossfadeSettingsSchema.optional(),
  })
  .strict()
  .refine((range) => range.sourceEnd > range.sourceStart, 'Redaction must have positive duration')
export type ClipRedaction = z.infer<typeof ClipRedactionSchema>

export const ClipSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  audioSourceId: AudioSourceIdSchema,
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().nonnegative(),
  outputStart: z.number().nonnegative(),
  gain: z.number().default(1),
  muted: z.boolean().default(false),
  redactions: z.array(ClipRedactionSchema).optional(),
  sourceOverrides: z.array(SourceOverrideSchema).optional(),
  effects: z.array(LegacyEffectSchema).default([]),
})
export type Clip = z.infer<typeof ClipSchema>

export const TrackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    clips: z.array(ClipSchema).default([]),
    mixLink: MixLinkSchema.extend({
      hiddenSegments: z
        .array(
          z
            .object({
              masterClipId: z.string().min(1),
              masterSourceStart: z.number().finite().nonnegative(),
              clip: ClipSchema.refine(
                (clip) =>
                  Number.isFinite(clip.sourceStart) &&
                  Number.isFinite(clip.sourceEnd) &&
                  clip.sourceEnd > clip.sourceStart &&
                  !clip.sourceOverrides?.length,
                'Hidden source segment must have valid raw source bounds',
              ),
            })
            .strict(),
        )
        .optional(),
    }).optional(),
    volume: z.number().default(1),
    gainDb: z.number().finite().min(-24).max(24).optional(),
    muted: z.boolean().default(false),
    solo: z.boolean().default(false),
    color: z.string().default('#4f46e5'),
    effects: z.array(EffectSchema).default([]),
  })
  .refine(
    (track) => track.effects.filter((effect) => effect.type === 'normalize').length <= 1,
    'Only one Normalize effect is allowed per track',
  )
export type Track = z.infer<typeof TrackSchema>
/** Content and presentation consumers do not depend on the live mixer level. */
export type TrackContent = Omit<Track, 'volume'>

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
    version: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    createdAt: z.string(),
    audioSettings: z.object({ processingSampleRate: z.literal(48_000) }).strict(),
    audioSources: z.array(AudioSourceSchema),
    speechArtifacts: z.array(SpeechArtifactRefSchema).default([]),
    speakerLabelOverrides: z.array(SpeakerLabelOverrideSchema).default([]),
    speakerIdentities: SpeakerIdentityCatalogSchema.optional(),
    adjustments: z.array(AdjustmentSchema).default([]),
    markers: z.array(MarkerSchema).default([]),
    export: ExportSettingsSchema.prefault({}),
    pluginData: z.record(z.string(), z.unknown()).default({}),
    tracks: z.array(TrackSchema).default([]),
  })
  .strict()
  .superRefine((project, context) => {
    if (
      project.version < 4 &&
      project.tracks.some(
        (track) =>
          track.gainDb !== undefined || track.effects.some((effect) => effect.type === 'normalize'),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['version'],
        message: 'Track gain and Normalize require project version 4',
      })
    }
    if (
      project.version === 2 &&
      project.tracks.some(
        (track) => track.mixLink || track.clips.some((clip) => clip.sourceOverrides),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['version'],
        message: 'Source relationships require project version 3',
      })
    }
    const trackIds = new Set<string>(),
      clipIds = new Set<string>(),
      owners = new Set<string>()
    for (const track of project.tracks) {
      if (trackIds.has(track.id))
        context.addIssue({ code: 'custom', path: ['tracks'], message: 'Duplicate track ID' })
      trackIds.add(track.id)
      for (const segment of track.mixLink?.hiddenSegments ?? []) {
        const parent = track.clips.find((clip) => clip.id === segment.masterClipId)
        const source = project.audioSources.find(
          (source) => source.id === segment.clip.audioSourceId,
        )
        const end = segment.masterSourceStart + segment.clip.sourceEnd - segment.clip.sourceStart
        if (
          !parent ||
          !track.mixLink!.stemTrackIds.includes(segment.clip.trackId) ||
          !source ||
          segment.clip.sourceEnd > source.metadata.durationSeconds ||
          (parent.sourceStart < end && parent.sourceEnd > segment.masterSourceStart)
        )
          context.addIssue({
            code: 'custom',
            path: ['tracks'],
            message:
              'Hidden source segments require a current parent, linked child and valid hidden source coverage',
          })
      }
      for (const stemId of track.mixLink?.stemTrackIds ?? []) {
        const stem = project.tracks.find((candidate) => candidate.id === stemId)
        if (!stem || stemId === track.id || stem.mixLink || owners.has(stemId))
          context.addIssue({
            code: 'custom',
            path: ['tracks'],
            message:
              'Mix sources require existing, uniquely owned children without nesting or cycles',
          })
        owners.add(stemId)
      }
      for (const clip of track.clips) {
        if (clipIds.has(clip.id))
          context.addIssue({ code: 'custom', path: ['tracks'], message: 'Duplicate clip ID' })
        clipIds.add(clip.id)
        const ids = new Set<string>()
        const ranges = [...(clip.sourceOverrides ?? [])].sort(
          (a, b) => a.sourceStart - b.sourceStart,
        )
        ranges.forEach((range, index) => {
          if (
            ids.has(range.id) ||
            (index > 0 && ranges[index - 1].sourceEnd > range.sourceStart) ||
            range.stemTrackIds.some((id) => !track.mixLink?.stemTrackIds.includes(id))
          )
            context.addIssue({
              code: 'custom',
              path: ['tracks'],
              message:
                'Source overrides require unique IDs, nonoverlapping ranges and linked children',
            })
          ids.add(range.id)
        })
      }
    }
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
        clip.sourceOverrides?.forEach((override, index) => {
          if (source && override.sourceEnd > source.metadata.durationSeconds) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'sourceOverrides', index],
              message: 'Source override bounds must remain within the audio source',
            })
          }
        })
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
  .transform((project) => ({ ...project, version: 4 as const }))
export type ProjectFile = z.infer<typeof ProjectFileSchema>

export function createEmptyProject(createdAt = new Date().toISOString()): ProjectFile {
  return ProjectFileSchema.parse({
    version: 4,
    createdAt,
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [],
    speechArtifacts: [],
    speakerLabelOverrides: [],
    tracks: [],
  })
}
