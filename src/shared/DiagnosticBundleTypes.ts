import { z } from 'zod'
import { LogLossesSchema } from './AppLogMessageTypes'

export const DiagnosticWarnings = {
  HistoryMissing: 'history-missing',
  LogsUnavailable: 'logs-unavailable',
  InvalidRecords: 'invalid-records',
  Losses: 'log-losses',
  IncompleteCounters: 'incomplete-counters',
} as const
export const DiagnosticCollectionRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recent') }).strict(),
  z
    .object({ kind: z.literal('failure'), diagnosticIds: z.array(z.uuid()).min(1).max(20) })
    .strict(),
])
export type DiagnosticCollectionRequest = z.infer<typeof DiagnosticCollectionRequestSchema>
export const DiagnosticBundleManifestSchema = z
  .object({
    bundleVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    environment: z
      .object({
        appVersion: z.string().max(64),
        platform: z.string().max(32),
        osVersion: z.string().max(128),
        architecture: z.string().max(32),
      })
      .strict(),
    diagnosticIds: z.array(z.uuid()).max(20),
    files: z
      .array(
        z
          .object({
            path: z.string().regex(/^(events\/application|runtime\/runtime)[0-9a-z.-]*\.jsonl$/),
            kind: z.enum(['events', 'runtime']),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(10),
    coverage: z
      .object({
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        scope: z.literal('retained-history'),
      })
      .strict(),
    losses: LogLossesSchema,
    warnings: z.array(z.enum(Object.values(DiagnosticWarnings))).max(10),
  })
  .strict()
export type DiagnosticBundleManifest = z.infer<typeof DiagnosticBundleManifestSchema>
export interface DiagnosticReportPreview {
  previewId: string
  manifest: DiagnosticBundleManifest
  totalBytes: number
}
export const DiagnosticChannels = {
  Preview: 'diagnostics:preview',
  Save: 'diagnostics:save',
  ShowSaved: 'diagnostics:show-saved',
  Inspect: 'diagnostics:inspect',
  Release: 'diagnostics:release',
  Open: 'diagnostics:open-recent',
} as const
