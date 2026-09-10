import { describe, expect, it } from 'vitest'
import { SpeechArtifactSchema, validateSpeechArtifactReference } from './speechArtifact.schema'

const SOURCE_ID = '550e8400-e29b-41d4-a716-446655440000'
const REVISION_ID = '550e8400-e29b-41d4-a716-446655440001'
const TRANSCRIPT_ID = '550e8400-e29b-41d4-a716-446655440002'
const ALIGNMENT_ID = '550e8400-e29b-41d4-a716-446655440003'
const DIARIZATION_ID = '550e8400-e29b-41d4-a716-446655440004'
const SPEAKER_ID = '550e8400-e29b-41d4-a716-446655440005'
const UNIT_A = '550e8400-e29b-41d4-a716-446655440006'
const UNIT_B = '550e8400-e29b-41d4-a716-446655440007'
const PUNCTUATION = '550e8400-e29b-41d4-a716-446655440008'
const AEU_A = '550e8400-e29b-41d4-a716-446655440009'
const AEU_B = '550e8400-e29b-41d4-a716-446655440010'

const fingerprint = { byteLength: 1024, modifiedTimeMs: 1000, sha256: 'a'.repeat(64) }
const engine = {
  engineId: 'test-engine',
  engineVersion: '1.0.0',
  modelId: 'test-model',
  modelVersion: 'revision-1',
  configHash: 'b'.repeat(64),
  artifactSchemaVersion: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
}

function artifact() {
  return {
    schemaVersion: 1,
    analysisRevisionId: REVISION_ID,
    audioSourceId: SOURCE_ID,
    sourceFingerprint: fingerprint,
    transcript: {
      id: TRANSCRIPT_ID,
      revision: 1,
      analysisRevisionId: REVISION_ID,
      audioSourceId: SOURCE_ID,
      sourceFingerprint: fingerprint,
      units: [
        { id: UNIT_A, text: '觉', kind: 'speech' },
        { id: UNIT_B, text: '得', kind: 'speech' },
        { id: PUNCTUATION, text: '。', kind: 'punctuation' },
      ],
      mode: 'best-effort-verbatim',
      provenance: engine,
    },
    alignment: {
      id: ALIGNMENT_ID,
      analysisRevisionId: REVISION_ID,
      transcriptArtifactId: TRANSCRIPT_ID,
      transcriptRevision: 1,
      audioSourceId: SOURCE_ID,
      sourceFingerprint: fingerprint,
      acousticEditUnits: [
        {
          id: AEU_A,
          transcriptUnitIds: [UNIT_A],
          audioSourceId: SOURCE_ID,
          sourceStart: 0.75,
          sourceEnd: 1.18,
          granularity: 'character',
          confidence: 0.9,
        },
        {
          id: AEU_B,
          transcriptUnitIds: [UNIT_B],
          audioSourceId: SOURCE_ID,
          sourceStart: 1.1,
          sourceEnd: 1.4,
          granularity: 'character',
        },
      ],
      provenance: engine,
    },
    diarization: {
      id: DIARIZATION_ID,
      analysisRevisionId: REVISION_ID,
      audioSourceId: SOURCE_ID,
      sourceFingerprint: fingerprint,
      turns: [
        {
          speakerId: SPEAKER_ID,
          audioSourceId: SOURCE_ID,
          sourceStart: 0.7,
          sourceEnd: 1.5,
        },
      ],
      provenance: engine,
    },
    speakerAttribution: {
      analysisRevisionId: REVISION_ID,
      alignmentArtifactId: ALIGNMENT_ID,
      diarizationArtifactId: DIARIZATION_ID,
      attributions: [
        { acousticEditUnitId: AEU_A, speakerId: SPEAKER_ID, confidence: 0.9, ambiguous: false },
        { acousticEditUnitId: AEU_B, speakerId: SPEAKER_ID, ambiguous: false },
      ],
      provenance: {
        algorithmId: 'overlap-duration',
        algorithmVersion: '1',
        configHash: 'c'.repeat(64),
        artifactSchemaVersion: 1,
        createdAt: '2026-09-09T00:00:00.000Z',
      },
    },
    speakers: [
      {
        id: SPEAKER_ID,
        analysisRevisionId: REVISION_ID,
        diarizationLabel: 'SPEAKER_00',
        defaultDisplayName: 'Speaker 1',
      },
    ],
  }
}

describe('SpeechArtifactSchema', () => {
  it('accepts overlapping acoustic ranges without inventing global exclusivity', () => {
    expect(SpeechArtifactSchema.parse(artifact()).alignment.acousticEditUnits).toHaveLength(2)
  })

  it('rejects punctuation membership in an acoustic edit unit', () => {
    const candidate = artifact()
    candidate.alignment.acousticEditUnits[0].transcriptUnitIds = [PUNCTUATION]
    expect(() => SpeechArtifactSchema.parse(candidate)).toThrow('speech TranscriptUnit')
  })

  it('rejects non-contiguous transcript membership', () => {
    const candidate = artifact()
    candidate.alignment.acousticEditUnits = [
      {
        ...candidate.alignment.acousticEditUnits[0],
        transcriptUnitIds: [UNIT_A, PUNCTUATION],
      },
    ]
    expect(() => SpeechArtifactSchema.parse(candidate)).toThrow('consecutive')
  })

  it('rejects one transcript unit belonging to multiple acoustic edit units', () => {
    const candidate = artifact()
    candidate.alignment.acousticEditUnits[1].transcriptUnitIds = [UNIT_A]
    expect(() => SpeechArtifactSchema.parse(candidate)).toThrow('at most one AcousticEditUnit')
  })

  it('rejects cross-revision artifacts and unknown speaker references', () => {
    const wrongRevision = artifact()
    wrongRevision.alignment.analysisRevisionId = '550e8400-e29b-41d4-a716-446655440099'
    expect(() => SpeechArtifactSchema.parse(wrongRevision)).toThrow('analysis revision')

    const unknownSpeaker = artifact()
    unknownSpeaker.diarization.turns[0].speakerId = '550e8400-e29b-41d4-a716-446655440099'
    expect(() => SpeechArtifactSchema.parse(unknownSpeaker)).toThrow('unknown Speaker')
  })

  it('rejects invalid source ranges', () => {
    const candidate = artifact()
    candidate.alignment.acousticEditUnits[0].sourceEnd = 0.75
    expect(() => SpeechArtifactSchema.parse(candidate)).toThrow('sourceStart < sourceEnd')
  })
})

describe('validateSpeechArtifactReference', () => {
  const reference = {
    audioSourceId: SOURCE_ID,
    analysisRevisionId: REVISION_ID,
    sourceFingerprint: fingerprint,
    artifactPath: `speech/${SOURCE_ID}/revision-${REVISION_ID}.json`,
    artifactSha256: 'd'.repeat(64),
    artifactByteLength: 4096,
    artifactSchemaVersion: 1,
    summary: { transcriptUnitCount: 3, acousticEditUnitCount: 2, speakerCount: 1 },
  }

  it('accepts matching digest-independent artifact metadata and summaries', () => {
    expect(() =>
      validateSpeechArtifactReference(reference, SpeechArtifactSchema.parse(artifact())),
    ).not.toThrow()
  })

  it('rejects stale source bindings and inaccurate summaries', () => {
    expect(() =>
      validateSpeechArtifactReference(
        { ...reference, summary: { ...reference.summary, speakerCount: 2 } },
        SpeechArtifactSchema.parse(artifact()),
      ),
    ).toThrow('summary')
    expect(() =>
      validateSpeechArtifactReference(
        { ...reference, sourceFingerprint: { ...fingerprint, byteLength: 999 } },
        SpeechArtifactSchema.parse(artifact()),
      ),
    ).toThrow('source fingerprint')
  })
})
