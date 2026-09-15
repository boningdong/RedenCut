import { z } from 'zod'
import { AudioSourceFingerprintSchema, AudioSourceIdSchema } from './source.types'
import {
  AlignmentArtifactSchema,
  AnalysisRevisionIdSchema,
  DiarizationArtifactSchema,
  SpeakerAttributionArtifactSchema,
  SpeakerSchema,
  TranscriptArtifactSchema,
} from './speech.types'

const base = z
  .object({
    analysisRevisionId: AnalysisRevisionIdSchema,
    audioSourceId: AudioSourceIdSchema,
    sourceFingerprint: AudioSourceFingerprintSchema,
    transcript: TranscriptArtifactSchema,
    alignment: AlignmentArtifactSchema,
  })
  .strict()

const completed = {
  diarization: DiarizationArtifactSchema,
  speakerAttribution: SpeakerAttributionArtifactSchema,
  speakers: z.array(SpeakerSchema),
}
export const SpeechArtifactSchema = z
  .union([
    base.extend({ schemaVersion: z.literal(1), ...completed }).strict(),
    base
      .extend({
        schemaVersion: z.literal(2),
        diarizationStatus: z.literal('completed'),
        ...completed,
      })
      .strict(),
    base
      .extend({
        schemaVersion: z.literal(2),
        diarizationStatus: z.enum(['skipped-disabled', 'pending']),
        diarization: z.undefined().optional(),
        speakerAttribution: z.undefined().optional(),
        speakers: z.array(SpeakerSchema).max(0),
      })
      .strict(),
  ])
  .superRefine((artifact, context) => {
    const revisionIds = [
      artifact.transcript.analysisRevisionId,
      artifact.alignment.analysisRevisionId,
      ...(artifact.diarization ? [artifact.diarization.analysisRevisionId] : []),
      ...(artifact.speakerAttribution ? [artifact.speakerAttribution.analysisRevisionId] : []),
      ...artifact.speakers.map((speaker) => speaker.analysisRevisionId),
    ]
    if (revisionIds.some((id) => id !== artifact.analysisRevisionId))
      issue(context, ['analysisRevisionId'], 'All artifacts must share one analysis revision')

    const sourceIds = [
      artifact.transcript.audioSourceId,
      artifact.alignment.audioSourceId,
      ...(artifact.diarization ? [artifact.diarization.audioSourceId] : []),
      ...artifact.alignment.acousticEditUnits.map((unit) => unit.audioSourceId),
      ...(artifact.diarization?.turns ?? []).map((turn) => turn.audioSourceId),
    ]
    if (sourceIds.some((id) => id !== artifact.audioSourceId))
      issue(context, ['audioSourceId'], 'All artifacts must reference one AudioSource')

    if (
      artifact.transcript.sourceFingerprint.sha256 !== artifact.sourceFingerprint.sha256 ||
      artifact.alignment.sourceFingerprint.sha256 !== artifact.sourceFingerprint.sha256 ||
      (artifact.diarization &&
        artifact.diarization.sourceFingerprint.sha256 !== artifact.sourceFingerprint.sha256)
    )
      issue(context, ['sourceFingerprint'], 'All artifacts must share one source fingerprint')

    if (
      artifact.alignment.transcriptArtifactId !== artifact.transcript.id ||
      artifact.alignment.transcriptRevision !== artifact.transcript.revision
    )
      issue(context, ['alignment'], 'Alignment must reference the contained transcript revision')

    if (
      artifact.speakerAttribution &&
      artifact.diarization &&
      (artifact.speakerAttribution.alignmentArtifactId !== artifact.alignment.id ||
        artifact.speakerAttribution.diarizationArtifactId !== artifact.diarization.id)
    )
      issue(
        context,
        ['speakerAttribution'],
        'Speaker attribution must reference contained artifacts',
      )

    const transcriptIndex = new Map(
      artifact.transcript.units.map((unit, index) => [unit.id, { unit, index }]),
    )
    const membership = new Set<string>()
    for (const acousticUnit of artifact.alignment.acousticEditUnits) {
      if (!(acousticUnit.sourceStart < acousticUnit.sourceEnd))
        issue(context, ['alignment'], 'AcousticEditUnit requires sourceStart < sourceEnd')
      const indexed = acousticUnit.transcriptUnitIds.map((id) => transcriptIndex.get(id))
      if (indexed.some((value) => !value || value.unit.kind !== 'speech'))
        issue(context, ['alignment'], 'AcousticEditUnit may reference only a speech TranscriptUnit')
      const positions = indexed.flatMap((value) => (value ? [value.index] : []))
      if (positions.some((position, index) => index > 0 && position !== positions[index - 1] + 1))
        issue(context, ['alignment'], 'TranscriptUnit membership must be consecutive and ordered')
      for (const id of acousticUnit.transcriptUnitIds) {
        if (membership.has(id))
          issue(
            context,
            ['alignment'],
            'A speech TranscriptUnit belongs to at most one AcousticEditUnit',
          )
        membership.add(id)
      }
    }

    for (const turn of artifact.diarization?.turns ?? [])
      if (!(turn.sourceStart < turn.sourceEnd))
        issue(context, ['diarization'], 'Diarization turn requires sourceStart < sourceEnd')

    const speakerIds = new Set(artifact.speakers.map((speaker) => speaker.id))
    if (speakerIds.size !== artifact.speakers.length)
      issue(context, ['speakers'], 'Speaker IDs must be unique')
    for (const turn of artifact.diarization?.turns ?? [])
      if (!speakerIds.has(turn.speakerId))
        issue(context, ['diarization'], 'Diarization turn references unknown Speaker')

    const acousticIds = new Set(
      artifact.alignment.acousticEditUnits.map((acousticUnit) => acousticUnit.id),
    )
    for (const attribution of artifact.speakerAttribution?.attributions ?? []) {
      if (!acousticIds.has(attribution.acousticEditUnitId))
        issue(context, ['speakerAttribution'], 'Attribution references unknown AcousticEditUnit')
      const referencedSpeakers = [
        ...(attribution.speakerId ? [attribution.speakerId] : []),
        ...(attribution.candidateSpeakerIds ?? []),
      ]
      if (referencedSpeakers.some((id) => !speakerIds.has(id)))
        issue(context, ['speakerAttribution'], 'Attribution references unknown Speaker')
    }
  })

export type SpeechArtifact = z.infer<typeof SpeechArtifactSchema>

interface SpeechArtifactReferenceMetadata {
  audioSourceId: string
  analysisRevisionId: string
  sourceFingerprint: { byteLength: number; modifiedTimeMs: number; sha256: string }
  artifactSchemaVersion: number
  summary: {
    transcriptUnitCount: number
    acousticEditUnitCount: number
    speakerCount: number
  }
}

export function validateSpeechArtifactReference(
  reference: SpeechArtifactReferenceMetadata,
  artifact: SpeechArtifact,
): void {
  if (
    reference.audioSourceId !== artifact.audioSourceId ||
    reference.analysisRevisionId !== artifact.analysisRevisionId ||
    reference.artifactSchemaVersion !== artifact.schemaVersion
  )
    throw new Error('Speech artifact reference does not match artifact identity')

  if (
    reference.sourceFingerprint.byteLength !== artifact.sourceFingerprint.byteLength ||
    reference.sourceFingerprint.modifiedTimeMs !== artifact.sourceFingerprint.modifiedTimeMs ||
    reference.sourceFingerprint.sha256 !== artifact.sourceFingerprint.sha256
  )
    throw new Error('Speech artifact reference does not match source fingerprint')

  const actualSummary = {
    transcriptUnitCount: artifact.transcript.units.length,
    acousticEditUnitCount: artifact.alignment.acousticEditUnits.length,
    speakerCount: artifact.speakers.length,
  }
  if (
    reference.summary.transcriptUnitCount !== actualSummary.transcriptUnitCount ||
    reference.summary.acousticEditUnitCount !== actualSummary.acousticEditUnitCount ||
    reference.summary.speakerCount !== actualSummary.speakerCount
  )
    throw new Error('Speech artifact reference summary does not match artifact contents')
}

function issue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: 'custom', path, message })
}
