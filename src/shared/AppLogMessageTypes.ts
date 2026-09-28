import { z } from 'zod'

export const LogLossesSchema = z
  .object({
    droppedRecords: z
      .object({
        info: z.number().int().nonnegative(),
        warn: z.number().int().nonnegative(),
        error: z.number().int().nonnegative(),
      })
      .strict(),
    truncatedRecords: z.number().int().nonnegative(),
    writeFailures: z.number().int().nonnegative(),
    countersComplete: z.boolean(),
  })
  .strict()
export type LogLosses = z.infer<typeof LogLossesSchema>
export const AppLogMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    time: z.iso.datetime(),
    sessionId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    level: z.enum(['info', 'warn', 'error']),
    source: z.enum(['main', 'python', 'ffmpeg', 'ffprobe', 'whisper']),
    component: z.string().max(96).optional(),
    stream: z.enum(['stdout', 'stderr']).optional(),
    operationId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    helperInstanceId: z.uuid().optional(),
    message: z.string().max(16384),
    stack: z.string().max(16384).optional(),
    truncated: z.boolean().optional(),
    losses: LogLossesSchema.optional(),
  })
  .strict()
export type AppLogMessage = z.infer<typeof AppLogMessageSchema>
export type LogLevel = AppLogMessage['level']
export type LogSource = AppLogMessage['source']
export const PythonLogMessageSchema = z
  .object({
    type: z.literal('log'),
    version: z.literal(1),
    level: z.enum(['info', 'warn', 'error']),
    logger: z.string().max(96),
    message: z.string().max(16384),
    stack: z.string().max(16384).optional(),
  })
  .strict()
export function emptyLogLosses(): LogLosses {
  return {
    droppedRecords: { info: 0, warn: 0, error: 0 },
    truncatedRecords: 0,
    writeFailures: 0,
    countersComplete: true,
  }
}
