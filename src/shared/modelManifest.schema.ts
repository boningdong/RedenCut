import { z } from 'zod'
const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      p.split('/').every((s) => s !== '..' && s !== '.' && s !== ''),
  )
const ModelFileSchema = z
  .object({
    path: relativePath,
    size: z.number().int().nonnegative(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    requiresAuthenticatedSha256: z.literal(true).optional(),
    gitBlobSha1: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
  })
  .refine((f) => !!f.sha256 || !!f.gitBlobSha1 || f.requiresAuthenticatedSha256 === true)
export const ModelDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    selection: z
      .object({
        family: z.literal('whisper'),
        variant: z.enum(['small', 'medium', 'large-v3']),
        recommended: z.boolean(),
      })
      .optional(),
    capability: z.enum(['transcription', 'transcription-smoke', 'alignment', 'diarization']),
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    expectedFiles: z.array(relativePath).min(1),
    files: z.array(ModelFileSchema).min(1),
    license: z.string(),
    access: z.enum(['public', 'gated-auto']),
    profiles: z.array(z.string()),
    supportedLanguages: z.array(z.string()),
  })
  .refine(
    (m) =>
      new Set(m.files.map((f) => f.path)).size === m.files.length &&
      m.files.every((f) => !f.requiresAuthenticatedSha256 || m.access === 'gated-auto') &&
      m.expectedFiles.length === m.files.length &&
      m.expectedFiles.every((p) => m.files.some((f) => f.path === p)),
  )
export const ModelManifestSchema = z.object({
  schemaVersion: z.literal(1),
  models: z
    .array(ModelDefinitionSchema)
    .min(1)
    .refine((models) => new Set(models.map((model) => model.id)).size === models.length),
})
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>
export type ModelFile = z.infer<typeof ModelFileSchema>
