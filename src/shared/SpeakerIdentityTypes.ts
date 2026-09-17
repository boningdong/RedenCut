import { z } from 'zod'
import { AudioSourceIdSchema } from './source.types'
import { AnalysisRevisionIdSchema, SpeakerIdSchema } from './speech.types'
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const name = z.string().min(1)
const SpeakerPersonSchema = z
  .object({
    id: z.string().min(1),
    displayName: name,
    color,
    binding: z
      .object({
        audioSourceId: AudioSourceIdSchema,
        analysisRevisionId: AnalysisRevisionIdSchema,
        speakerId: SpeakerIdSchema,
      })
      .strict(),
  })
  .strict()
const SpeakerAssociationSchema = z
  .object({
    id: z.string().min(1),
    displayName: name,
    color: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('automatic') }).strict(),
      z.object({ mode: z.literal('custom'), value: color }).strict(),
    ]),
    memberPersonIds: z.array(z.string().min(1)).min(2),
  })
  .strict()
export const SpeakerIdentityCatalogSchema = z
  .object({
    version: z.literal(1),
    people: z.array(SpeakerPersonSchema),
    associations: z.array(SpeakerAssociationSchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>(),
      bindings = new Set<string>(),
      members = new Set<string>()
    const issue = (message: string) => context.addIssue({ code: 'custom', message })
    for (const person of catalog.people) {
      const binding = JSON.stringify([
        person.binding.audioSourceId,
        person.binding.analysisRevisionId,
        person.binding.speakerId,
      ])
      if (ids.has(person.id) || bindings.has(binding))
        issue('Duplicate person identity or source binding')
      ids.add(person.id)
      bindings.add(binding)
    }
    const associationIds = new Set<string>()
    for (const association of catalog.associations) {
      if (associationIds.has(association.id) || ids.has(association.id))
        issue('Duplicate association identity')
      associationIds.add(association.id)
      for (const id of association.memberPersonIds) {
        if (!ids.has(id) || members.has(id))
          issue('Association members must exist and belong to one association')
        members.add(id)
      }
    }
  })
export type SpeakerPerson = z.infer<typeof SpeakerPersonSchema>
export type SpeakerAssociation = z.infer<typeof SpeakerAssociationSchema>
export type SpeakerIdentityCatalog = z.infer<typeof SpeakerIdentityCatalogSchema>
export type SpeakerIdentityTarget = { kind: 'person' | 'association'; id: string }
export const SaveSpeakerIdentitiesRequestSchema = z
  .object({
    workspaceToken: z.string().min(1),
    expected: SpeakerIdentityCatalogSchema,
    next: SpeakerIdentityCatalogSchema,
  })
  .strict()
export type SaveSpeakerIdentitiesRequest = z.infer<typeof SaveSpeakerIdentitiesRequestSchema>
