import { z } from 'zod'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const AudioSourceIdSchema = z.string().uuid().brand<'AudioSourceId'>()
export type AudioSourceId = z.infer<typeof AudioSourceIdSchema>

export const ProjectRelativePathSchema = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.includes('\\') &&
      value
        .split('/')
        .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    'Expected a normalized project-relative path',
  )
  .brand<'ProjectRelativePath'>()
export type ProjectRelativePath = z.infer<typeof ProjectRelativePathSchema>

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

const AudioSourceFingerprintSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    modifiedTimeMs: z.number().nonnegative(),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict()

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

const TranscriptSchema = z
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

const ClipSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  audioSourceId: AudioSourceIdSchema,
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().nonnegative(),
  outputStart: z.number().nonnegative(),
  gain: z.number().default(1),
  muted: z.boolean().default(false),
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

export const ProjectFileSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string(),
    audioSettings: z.object({ processingSampleRate: z.literal(48_000) }).strict(),
    audioSources: z.array(AudioSourceSchema),
    transcript: TranscriptSchema.optional(),
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
      })
    })
    project.transcript?.words.forEach((word, wordIndex) => {
      if (word.audioSourceId && !sources.has(word.audioSourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['transcript', 'words', wordIndex, 'audioSourceId'],
          message: 'Word references unknown AudioSource',
        })
      }
    })
  })
export type ProjectFile = z.infer<typeof ProjectFileSchema>

export function createEmptyProject(createdAt = new Date().toISOString()): ProjectFile {
  return ProjectFileSchema.parse({
    version: 1,
    createdAt,
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [],
    tracks: [],
  })
}
