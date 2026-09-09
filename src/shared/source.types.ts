import { z } from 'zod'

export const SHA256_PATTERN = /^[a-f0-9]{64}$/

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

export const AudioSourceFingerprintSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    modifiedTimeMs: z.number().nonnegative(),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict()
export type AudioSourceFingerprint = z.infer<typeof AudioSourceFingerprintSchema>
