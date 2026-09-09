import type { AudioSourceFingerprint, AudioSourceId } from '../../shared/source.types'
import {
  TranscriptArtifactSchema,
  type AnalysisRevisionId,
  type TranscriptArtifact,
} from '../../shared/speech.types'
import type { TranscriptionResult } from '../../shared/transcriber.types'

interface BuildInput {
  result: TranscriptionResult
  audioSourceId: AudioSourceId
  sourceFingerprint: AudioSourceFingerprint
  analysisRevisionId: AnalysisRevisionId
  transcriptRevision?: number
}

export class CanonicalTranscriptBuilder {
  constructor(private readonly createId: () => string) {}

  build(input: BuildInput): TranscriptArtifact {
    return TranscriptArtifactSchema.parse({
      id: this.createId(),
      revision: input.transcriptRevision ?? 1,
      analysisRevisionId: input.analysisRevisionId,
      audioSourceId: input.audioSourceId,
      sourceFingerprint: input.sourceFingerprint,
      units: tokenize(input.result.text).map(({ text, kind }) => ({
        id: this.createId(),
        text,
        kind,
      })),
      mode: input.result.verbatimCapability,
      provenance: input.result.provenance,
    })
  }
}

function tokenize(text: string): Array<{ text: string; kind: 'speech' | 'punctuation' }> {
  const units: Array<{ text: string; kind: 'speech' | 'punctuation' }> = []
  let word = ''
  const flushWord = () => {
    if (word) units.push({ text: word, kind: 'speech' })
    word = ''
  }
  for (const character of text.normalize('NFC')) {
    if (/\s/u.test(character)) {
      flushWord()
    } else if (/\p{P}/u.test(character)) {
      flushWord()
      units.push({ text: character, kind: 'punctuation' })
    } else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) {
      flushWord()
      units.push({ text: character, kind: 'speech' })
    } else {
      word += character
    }
  }
  flushWord()
  return units
}
