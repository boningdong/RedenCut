import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SpeechArtifactSchema, type SpeechArtifact } from '../../shared/speechArtifact.schema'
import { SpeechArtifactStore } from './SpeechArtifactStore'

const ids = {
  source: '550e8400-e29b-41d4-a716-446655440000',
  revision: '550e8400-e29b-41d4-a716-446655440001',
  transcript: '550e8400-e29b-41d4-a716-446655440002',
  unit: '550e8400-e29b-41d4-a716-446655440003',
  alignment: '550e8400-e29b-41d4-a716-446655440004',
  acoustic: '550e8400-e29b-41d4-a716-446655440005',
  diarization: '550e8400-e29b-41d4-a716-446655440006',
  speaker: '550e8400-e29b-41d4-a716-446655440007',
}
const fingerprint = { byteLength: 42, modifiedTimeMs: 1000, sha256: 'a'.repeat(64) }
const engine = {
  engineId: 'test',
  engineVersion: '1',
  modelId: 'model',
  configHash: 'b'.repeat(64),
  artifactSchemaVersion: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
}
const algorithm = {
  algorithmId: 'overlap',
  algorithmVersion: '1',
  configHash: 'c'.repeat(64),
  artifactSchemaVersion: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
}

function artifact(): SpeechArtifact {
  return SpeechArtifactSchema.parse({
    schemaVersion: 1,
    analysisRevisionId: ids.revision,
    audioSourceId: ids.source,
    sourceFingerprint: fingerprint,
    transcript: {
      id: ids.transcript,
      revision: 1,
      analysisRevisionId: ids.revision,
      audioSourceId: ids.source,
      sourceFingerprint: fingerprint,
      units: [{ id: ids.unit, text: 'hello', kind: 'speech' }],
      mode: 'best-effort-verbatim',
      provenance: engine,
    },
    alignment: {
      id: ids.alignment,
      analysisRevisionId: ids.revision,
      transcriptArtifactId: ids.transcript,
      transcriptRevision: 1,
      audioSourceId: ids.source,
      sourceFingerprint: fingerprint,
      acousticEditUnits: [
        {
          id: ids.acoustic,
          transcriptUnitIds: [ids.unit],
          audioSourceId: ids.source,
          sourceStart: 0.1,
          sourceEnd: 0.6,
          granularity: 'word',
        },
      ],
      provenance: engine,
    },
    diarization: {
      id: ids.diarization,
      analysisRevisionId: ids.revision,
      audioSourceId: ids.source,
      sourceFingerprint: fingerprint,
      turns: [{ speakerId: ids.speaker, audioSourceId: ids.source, sourceStart: 0, sourceEnd: 1 }],
      provenance: engine,
    },
    speakerAttribution: {
      analysisRevisionId: ids.revision,
      alignmentArtifactId: ids.alignment,
      diarizationArtifactId: ids.diarization,
      attributions: [
        { acousticEditUnitId: ids.acoustic, speakerId: ids.speaker, ambiguous: false },
      ],
      provenance: algorithm,
    },
    speakers: [
      {
        id: ids.speaker,
        analysisRevisionId: ids.revision,
        diarizationLabel: 'SPEAKER_00',
        defaultDisplayName: 'Speaker 1',
      },
    ],
  })
}

describe('SpeechArtifactStore', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'redencut-speech-store-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('publishes deterministic bytes at a readable path and verifies them on load', async () => {
    const store = new SpeechArtifactStore(root)
    const first = store.prepare(artifact())
    const second = store.prepare(artifact())
    expect(first.bytes.equals(second.bytes)).toBe(true)
    expect(first.reference.artifactPath).toBe(
      `speech/${ids.source}/revision-${ids.revision}-${first.reference.artifactSha256}.json`,
    )
    const staged = await store.stage(first)
    await store.publish(staged)
    await expect(store.load(first.reference)).resolves.toEqual(artifact())
    expect((await readFile(join(root, first.reference.artifactPath))).byteLength).toBe(
      first.reference.artifactByteLength,
    )
  })

  it('rejects final-file collisions and cleans abandoned staged writes', async () => {
    const store = new SpeechArtifactStore(root)
    const prepared = store.prepare(artifact())
    const first = await store.stage(prepared)
    await store.publish(first)
    const second = await store.stage(prepared)
    await expect(store.publish(second)).rejects.toThrow('already exists')
    await store.discard(second)
    await expect(readFile(second.stagedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects corrupt bytes, mismatched metadata, and paths outside speech storage', async () => {
    const store = new SpeechArtifactStore(root)
    const prepared = store.prepare(artifact())
    const staged = await store.stage(prepared)
    await store.publish(staged)
    await writeFile(join(root, prepared.reference.artifactPath), '{}')
    await expect(store.load(prepared.reference)).rejects.toThrow('integrity')
    await expect(
      store.load({ ...prepared.reference, artifactPath: '../outside.json' as never }),
    ).rejects.toThrow('confined')
    const wrong = {
      ...prepared.reference,
      summary: { ...prepared.reference.summary, speakerCount: 2 },
    }
    await expect(store.load(wrong)).rejects.toThrow()
  })
  it('loads legacy bytes without rewriting and publishes skipped results as a new revision', async () => {
    const store = new SpeechArtifactStore(root)
    const old = store.prepare(artifact())
    await store.publish(await store.stage(old))
    const oldPath = join(root, old.reference.artifactPath)
    const before = await readFile(oldPath)
    await store.load(old.reference)
    expect(await readFile(oldPath)).toEqual(before)
    const revision = '550e8400-e29b-41d4-a716-446655440099'
    const previous = artifact()
    const next = SpeechArtifactSchema.parse({
      ...previous,
      schemaVersion: 2,
      diarizationStatus: 'skipped-disabled',
      analysisRevisionId: revision,
      transcript: { ...previous.transcript, analysisRevisionId: revision },
      alignment: { ...previous.alignment, analysisRevisionId: revision },
      diarization: undefined,
      speakerAttribution: undefined,
      speakers: [],
    })
    const prepared = store.prepare(next)
    const abandoned = await store.stage(prepared)
    await store.discard(abandoned)
    expect(await store.load(old.reference)).toEqual(previous)
    await store.publish(await store.stage(prepared))
    expect(await store.load(prepared.reference)).toMatchObject({
      schemaVersion: 2,
      diarizationStatus: 'skipped-disabled',
      speakers: [],
    })
    expect(await readFile(oldPath)).toEqual(before)
  })
})
