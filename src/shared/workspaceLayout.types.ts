import type { PublicMessage } from './publicMessages'
import { z } from 'zod'

const ContentOrderSchema = z.union([
  z.tuple([z.literal('transcript'), z.literal('audio')]),
  z.tuple([z.literal('audio'), z.literal('transcript')]),
])
const TranscriptRatioSchema = z.number().finite().min(0.1).max(0.9)
const TransportPositionSchema = z.enum(['top', 'bottom'])

export const WorkspaceLayoutSchema = z
  .object({
    version: z.literal(1),
    contentOrder: ContentOrderSchema,
    transcriptRatio: TranscriptRatioSchema,
    transportPosition: TransportPositionSchema,
  })
  .strict()

export type WorkspaceLayout = z.infer<typeof WorkspaceLayoutSchema>

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  version: 1,
  contentOrder: ['transcript', 'audio'],
  transcriptRatio: 0.6,
  transportPosition: 'bottom',
}
Object.freeze(DEFAULT_WORKSPACE_LAYOUT.contentOrder)
Object.freeze(DEFAULT_WORKSPACE_LAYOUT)

export interface WorkspaceLayoutReadResult {
  layout: WorkspaceLayout
  warning: PublicMessage | null
}

export function decodeStoredWorkspaceLayout(input: unknown): WorkspaceLayoutReadResult {
  const valid = WorkspaceLayoutSchema.safeParse(input)
  if (valid.success) return { layout: valid.data, warning: null }
  const defaults = WorkspaceLayoutSchema.parse(DEFAULT_WORKSPACE_LAYOUT)
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return {
      layout: defaults,
      warning: { reason: 'workspace-invalid' },
    }
  const record = input as Record<string, unknown>
  if (record.version !== 1)
    return {
      layout: defaults,
      warning: { reason: 'workspace-version' },
    }
  const knownPanels = Array.isArray(record.contentOrder)
    ? record.contentOrder.filter((panel) => panel === 'audio' || panel === 'transcript')
    : []
  const contentOrder = ContentOrderSchema.parse([
    ...new Set([...knownPanels, ...defaults.contentOrder]),
  ])
  const ratio = TranscriptRatioSchema.safeParse(record.transcriptRatio)
  const transport = TransportPositionSchema.safeParse(record.transportPosition)
  return {
    layout: {
      version: 1,
      contentOrder,
      transcriptRatio: ratio.success ? ratio.data : defaults.transcriptRatio,
      transportPosition: transport.success ? transport.data : defaults.transportPosition,
    },
    warning: { reason: 'workspace-recovered' },
  }
}
