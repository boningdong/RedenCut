import { z } from 'zod'
import {
  AudioSourceFingerprintSchema,
  AudioSourceIdSchema,
  SHA256_PATTERN,
  type AudioSourceId,
} from './source.types'

const brandedUuid = <Brand extends string>(_brand: Brand) => z.string().uuid().brand<Brand>()

export const AnalysisRevisionIdSchema = brandedUuid('AnalysisRevisionId')
export const TranscriptArtifactIdSchema = brandedUuid('TranscriptArtifactId')
export const TranscriptUnitIdSchema = brandedUuid('TranscriptUnitId')
export const AlignmentArtifactIdSchema = brandedUuid('AlignmentArtifactId')
export const AcousticEditUnitIdSchema = brandedUuid('AcousticEditUnitId')
export const DiarizationArtifactIdSchema = brandedUuid('DiarizationArtifactId')
export const SpeakerIdSchema = brandedUuid('SpeakerId')

export type AnalysisRevisionId = z.infer<typeof AnalysisRevisionIdSchema>
export type TranscriptArtifactId = z.infer<typeof TranscriptArtifactIdSchema>
export type TranscriptUnitId = z.infer<typeof TranscriptUnitIdSchema>
export type AlignmentArtifactId = z.infer<typeof AlignmentArtifactIdSchema>
export type AcousticEditUnitId = z.infer<typeof AcousticEditUnitIdSchema>
export type DiarizationArtifactId = z.infer<typeof DiarizationArtifactIdSchema>
export type SpeakerId = z.infer<typeof SpeakerIdSchema>

export const EngineProvenanceSchema = z
  .object({
    engineId: z.string().min(1),
    engineVersion: z.string().min(1),
    modelId: z.string().min(1),
    modelVersion: z.string().min(1).optional(),
    configHash: z.string().regex(SHA256_PATTERN),
    artifactSchemaVersion: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict()

export const AlgorithmProvenanceSchema = z
  .object({
    algorithmId: z.string().min(1),
    algorithmVersion: z.string().min(1),
    configHash: z.string().regex(SHA256_PATTERN),
    artifactSchemaVersion: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict()

export const TranscriptUnitSchema = z
  .object({
    id: TranscriptUnitIdSchema,
    text: z.string().min(1),
    kind: z.enum(['speech', 'punctuation']),
  })
  .strict()

export const TranscriptArtifactSchema = z
  .object({
    id: TranscriptArtifactIdSchema,
    revision: z.number().int().positive(),
    analysisRevisionId: AnalysisRevisionIdSchema,
    audioSourceId: AudioSourceIdSchema,
    sourceFingerprint: AudioSourceFingerprintSchema,
    units: z.array(TranscriptUnitSchema),
    mode: z.enum(['verbatim', 'best-effort-verbatim']),
    provenance: EngineProvenanceSchema,
  })
  .strict()

const finiteTime = z.number().nonnegative().refine(Number.isFinite, 'Expected finite source time')

export const AcousticEditUnitSchema = z
  .object({
    id: AcousticEditUnitIdSchema,
    transcriptUnitIds: z.array(TranscriptUnitIdSchema).min(1),
    audioSourceId: AudioSourceIdSchema,
    sourceStart: finiteTime,
    sourceEnd: finiteTime,
    granularity: z.enum(['character', 'word', 'phrase', 'utterance']),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()

export const AlignmentArtifactSchema = z
  .object({
    id: AlignmentArtifactIdSchema,
    analysisRevisionId: AnalysisRevisionIdSchema,
    transcriptArtifactId: TranscriptArtifactIdSchema,
    transcriptRevision: z.number().int().positive(),
    audioSourceId: AudioSourceIdSchema,
    sourceFingerprint: AudioSourceFingerprintSchema,
    acousticEditUnits: z.array(AcousticEditUnitSchema),
    provenance: EngineProvenanceSchema,
  })
  .strict()

export const SpeakerSchema = z
  .object({
    id: SpeakerIdSchema,
    analysisRevisionId: AnalysisRevisionIdSchema,
    diarizationLabel: z.string().min(1),
    defaultDisplayName: z.string().min(1),
  })
  .strict()

export const DiarizationTurnSchema = z
  .object({
    speakerId: SpeakerIdSchema,
    audioSourceId: AudioSourceIdSchema,
    sourceStart: finiteTime,
    sourceEnd: finiteTime,
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()

export const DiarizationArtifactSchema = z
  .object({
    id: DiarizationArtifactIdSchema,
    analysisRevisionId: AnalysisRevisionIdSchema,
    audioSourceId: AudioSourceIdSchema,
    sourceFingerprint: AudioSourceFingerprintSchema,
    turns: z.array(DiarizationTurnSchema),
    provenance: EngineProvenanceSchema,
  })
  .strict()

export const SpeakerAttributionSchema = z
  .object({
    acousticEditUnitId: AcousticEditUnitIdSchema,
    speakerId: SpeakerIdSchema.optional(),
    candidateSpeakerIds: z.array(SpeakerIdSchema).optional(),
    confidence: z.number().min(0).max(1).optional(),
    ambiguous: z.boolean(),
  })
  .strict()

export const SpeakerAttributionArtifactSchema = z
  .object({
    analysisRevisionId: AnalysisRevisionIdSchema,
    alignmentArtifactId: AlignmentArtifactIdSchema,
    diarizationArtifactId: DiarizationArtifactIdSchema,
    attributions: z.array(SpeakerAttributionSchema),
    provenance: AlgorithmProvenanceSchema,
  })
  .strict()

export type EngineProvenance = z.infer<typeof EngineProvenanceSchema>
export type TranscriptUnit = z.infer<typeof TranscriptUnitSchema>
export type TranscriptArtifact = z.infer<typeof TranscriptArtifactSchema>
export type AcousticEditUnit = z.infer<typeof AcousticEditUnitSchema>
export type AlignmentArtifact = z.infer<typeof AlignmentArtifactSchema>
export type Speaker = z.infer<typeof SpeakerSchema>
export type DiarizationArtifact = z.infer<typeof DiarizationArtifactSchema>
export type SpeakerAttribution = z.infer<typeof SpeakerAttributionSchema>
export type SpeakerAttributionArtifact = z.infer<typeof SpeakerAttributionArtifactSchema>

export interface RendererSpeechAnalysis {
  audioSourceId: AudioSourceId
  analysisRevisionId: AnalysisRevisionId
  transcript: Pick<TranscriptArtifact, 'id' | 'revision' | 'units' | 'mode' | 'provenance'>
  alignment: Pick<
    AlignmentArtifact,
    'id' | 'transcriptArtifactId' | 'transcriptRevision' | 'acousticEditUnits' | 'provenance'
  >
  diarization: Pick<DiarizationArtifact, 'id' | 'turns' | 'provenance'>
  speakerAttribution: SpeakerAttributionArtifact
  speakers: Speaker[]
  speakerLabelOverrides: Array<{ speakerId: SpeakerId; displayName: string; color?: string }>
}
