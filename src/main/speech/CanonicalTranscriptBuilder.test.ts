import { describe, expect, it } from 'vitest'
import type { AudioSourceFingerprint, AudioSourceId } from '../../shared/source.types'
import type { AnalysisRevisionId } from '../../shared/speech.types'
import type { TranscriptionResult } from '../../shared/transcriber.types'
import { CanonicalTranscriptBuilder } from './CanonicalTranscriptBuilder'

const sourceId = '550e8400-e29b-41d4-a716-446655440000' as AudioSourceId
const revisionId = '550e8400-e29b-41d4-a716-446655440001' as AnalysisRevisionId
const fingerprint: AudioSourceFingerprint = {
  byteLength: 12,
  modifiedTimeMs: 34,
  sha256: 'a'.repeat(64),
}

function result(text: string): TranscriptionResult {
  return {
    text,
    detectedLanguage: 'zh',
    verbatimCapability: 'best-effort-verbatim',
    evidence: [{ text }],
    provenance: {
      engineId: 'whisper.cpp',
      engineVersion: 'unknown',
      modelId: 'ggml-base.bin',
      configHash: 'b'.repeat(64),
      artifactSchemaVersion: 1,
      createdAt: '2026-09-09T00:00:00.000Z',
    },
  }
}

describe('CanonicalTranscriptBuilder', () => {
  it('creates selectable Chinese characters, Latin words, and acoustically inert punctuation', () => {
    const artifact = new CanonicalTranscriptBuilder(() => crypto.randomUUID()).build({
      result: result('我觉得 PodCut works, 真的。'),
      audioSourceId: sourceId,
      sourceFingerprint: fingerprint,
      analysisRevisionId: revisionId,
    })

    expect(artifact.units.map(({ text, kind }) => ({ text, kind }))).toEqual([
      { text: '我', kind: 'speech' },
      { text: '觉', kind: 'speech' },
      { text: '得', kind: 'speech' },
      { text: 'PodCut', kind: 'speech' },
      { text: 'works', kind: 'speech' },
      { text: ',', kind: 'punctuation' },
      { text: '真', kind: 'speech' },
      { text: '的', kind: 'speech' },
      { text: '。', kind: 'punctuation' },
    ])
    expect(artifact.units.every((unit) => unit.text.trim().length > 0)).toBe(true)
    expect(new Set(artifact.units.map((unit) => unit.id)).size).toBe(artifact.units.length)
    expect(artifact.mode).toBe('best-effort-verbatim')
  })
})
