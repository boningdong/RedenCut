import { z } from 'zod'

const runtimePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !value.includes(':') &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    'Expected a contained relative runtime path',
  )
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const RuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    platform: z.enum(['darwin', 'linux', 'win32']),
    arch: z.enum(['arm64', 'x64']),
    executables: z.object({
      ffmpeg: runtimePath,
      ffprobe: runtimePath,
      'whisper-cli': runtimePath.optional(),
      python: runtimePath.optional(),
      uv: runtimePath.optional(),
    }),
    components: z
      .array(
        z.object({
          name: z.string().min(1),
          version: z.string().min(1),
          license: z.string().min(1),
          sourceUrl: z.string().url(),
          sourceSha256: sha256.optional(),
        }),
      )
      .min(1),
    files: z.array(z.object({ path: runtimePath, sha256 })).min(1),
  })
  .superRefine((manifest, context) => {
    const paths = new Set(manifest.files.map((file) => file.path))
    if (
      paths.size !== manifest.files.length ||
      Object.values(manifest.executables).some((path) => path !== undefined && !paths.has(path))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Entrypoints must have unique integrity records',
      })
    }
  })
export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>
export type RuntimeExecutable = keyof RuntimeManifest['executables']
