import { z } from 'zod'
import { AudioSourceIdSchema, ProjectRelativePathSchema } from '../../../shared/project.types'

export const CACHE_GENERATOR_VERSION = 'riffcut-cache-v1'
export const WAVEFORM_LEVELS = [256, 4096, 65536] as const

const WaveformLevelSchema = z.object({
  file: ProjectRelativePathSchema,
  samplesPerBucket: z.union([z.literal(256), z.literal(4096), z.literal(65536)]),
  bucketCount: z.number().int().nonnegative(),
})

export const AudioSourceCacheManifestSchema = z
  .object({
    version: z.literal(1),
    audioSourceId: AudioSourceIdSchema,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    generatorVersion: z.literal(CACHE_GENERATOR_VERSION),
    pcm: z.object({
      file: ProjectRelativePathSchema,
      sampleFormat: z.literal('f32le'),
      layout: z.literal('interleaved'),
      sampleRate: z.literal(48_000),
      channels: z.number().int().positive(),
      frameCount: z.number().int().nonnegative(),
      byteLength: z.number().int().nonnegative(),
    }),
    waveform: z.object({
      representation: z.literal('min-max-f32le'),
      levels: z.array(WaveformLevelSchema).length(WAVEFORM_LEVELS.length),
    }),
  })
  .superRefine((manifest, context) => {
    if (manifest.pcm.byteLength !== manifest.pcm.frameCount * manifest.pcm.channels * 4) {
      context.addIssue({
        code: 'custom',
        path: ['pcm', 'byteLength'],
        message: 'PCM byte length does not match frame and channel counts',
      })
    }
    const levels = manifest.waveform.levels.map((level) => level.samplesPerBucket)
    if (new Set(levels).size !== levels.length) {
      context.addIssue({ code: 'custom', path: ['waveform', 'levels'], message: 'Duplicate level' })
    }
    if (WAVEFORM_LEVELS.some((level) => !levels.includes(level))) {
      context.addIssue({
        code: 'custom',
        path: ['waveform', 'levels'],
        message: 'Missing required waveform level',
      })
    }
    manifest.waveform.levels.forEach((level, index) => {
      if (level.bucketCount !== Math.ceil(manifest.pcm.frameCount / level.samplesPerBucket)) {
        context.addIssue({
          code: 'custom',
          path: ['waveform', 'levels', index, 'bucketCount'],
          message: 'Waveform bucket count does not cover PCM frame count',
        })
      }
    })
  })

export type AudioSourceCacheManifest = z.infer<typeof AudioSourceCacheManifestSchema>
