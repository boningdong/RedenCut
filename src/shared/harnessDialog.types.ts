import { z } from 'zod'

const cancel = z.object({ type: z.literal('cancel') }).strict()
const project = z.object({ type: z.literal('project'), name: z.string().min(1) }).strict()
export const HarnessDialogRequestSchema = z.discriminatedUnion('purpose', [
  z
    .object({
      purpose: z.literal('import-audio'),
      selection: z.union([
        cancel,
        z.object({ type: z.literal('file'), filename: z.string().min(1) }).strict(),
      ]),
    })
    .strict(),
  z.object({ purpose: z.literal('save-project'), selection: z.union([cancel, project]) }).strict(),
  z.object({ purpose: z.literal('open-project'), selection: z.union([cancel, project]) }).strict(),
])
export type HarnessDialogRequest = z.infer<typeof HarnessDialogRequestSchema>
export const HarnessDialogReplySchema = z
  .object({
    purpose: z.enum(['import-audio', 'save-project', 'open-project']),
    path: z.string().min(1).nullable(),
    parent: z.string().min(1).nullable().default(null),
  })
  .strict()
