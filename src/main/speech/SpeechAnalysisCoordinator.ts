import { createHash } from 'crypto'
import type { AudioSourceFingerprint, AudioSourceId } from '../../shared/source.types'
import { EngineProvenanceSchema, type TranscriptArtifact } from '../../shared/speech.types'
import { SpeechArtifactSchema, type SpeechArtifact } from '../../shared/speechArtifact.schema'
import type { SpeechWorkerRequest, SpeechWorkerResult } from '../../shared/speechWorker.types'
import type { ITranscriber, TranscriptionResult } from '../../shared/transcriber.types'
import { CanonicalTranscriptBuilder } from './CanonicalTranscriptBuilder'
import { attributeSpeakers } from './SpeakerAttribution'

interface Worker {
  run(
    request: SpeechWorkerRequest,
    signal: AbortSignal,
    onProgress?: (event: { stage: 'aligning' | 'diarizing'; percent?: number }) => void,
  ): Promise<SpeechWorkerResult>
}

interface AnalysisInput {
  jobId: string
  audioPath: string
  audioSource: { id: string; fingerprint: AudioSourceFingerprint }
  language: string
  alignmentModel: string
  diarizationModel: string
}

export interface SpeechAnalysisProgress {
  stage: 'transcribing' | 'aligning' | 'diarizing' | 'attributing-speakers' | 'validating'
  percent?: number
}

export class SpeechAnalysisCoordinator {
  constructor(
    private readonly transcriber: Pick<ITranscriber, 'transcribe'>,
    private readonly worker: Worker,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async run(
    input: AnalysisInput,
    signal: AbortSignal,
    onProgress: (progress: SpeechAnalysisProgress) => void = () => {},
  ): Promise<SpeechArtifact> {
    signal.throwIfAborted()
    onProgress({ stage: 'transcribing' })
    const transcription: TranscriptionResult = await this.transcriber.transcribe(
      input.audioPath,
      { language: input.language },
      signal,
    )
    signal.throwIfAborted()
    const analysisRevisionId = this.createId()
    const transcript: TranscriptArtifact = new CanonicalTranscriptBuilder(this.createId).build({
      result: transcription,
      audioSourceId: input.audioSource.id as AudioSourceId,
      sourceFingerprint: input.audioSource.fingerprint,
      analysisRevisionId: analysisRevisionId as never,
    })
    const workerResult = await this.worker.run(
      {
        protocolVersion: 1,
        jobId: input.jobId,
        audioPath: input.audioPath,
        language: transcription.detectedLanguage || input.language,
        transcriptUnits: transcript.units,
        models: {
          alignment:
            input.alignmentModel === 'auto'
              ? transcription.detectedLanguage.toLowerCase().startsWith('zh')
                ? 'alignment-zh'
                : 'alignment-en'
              : input.alignmentModel,
          diarization: input.diarizationModel,
        },
        config: { device: 'cpu' },
      },
      signal,
      onProgress,
    )
    signal.throwIfAborted()
    const alignmentId = this.createId()
    const acousticEditUnits = workerResult.alignment.units.map((unit) => ({
      id: this.createId(),
      transcriptUnitIds: unit.transcriptUnitIds,
      audioSourceId: input.audioSource.id,
      sourceStart: unit.sourceStart,
      sourceEnd: unit.sourceEnd,
      granularity: unit.granularity,
      confidence: unit.confidence,
    }))
    onProgress({ stage: 'attributing-speakers' })
    const attributed = attributeSpeakers(
      acousticEditUnits,
      workerResult.diarization.turns,
      this.createId,
    )
    const speakerByLabel = new Map(
      attributed.speakers.map((speaker) => [speaker.diarizationLabel, speaker.id]),
    )
    const diarizationId = this.createId()
    const createdAt = this.now()
    onProgress({ stage: 'validating' })
    return SpeechArtifactSchema.parse({
      schemaVersion: 1,
      analysisRevisionId,
      audioSourceId: input.audioSource.id,
      sourceFingerprint: input.audioSource.fingerprint,
      transcript,
      alignment: {
        id: alignmentId,
        analysisRevisionId,
        transcriptArtifactId: transcript.id,
        transcriptRevision: transcript.revision,
        audioSourceId: input.audioSource.id,
        sourceFingerprint: input.audioSource.fingerprint,
        acousticEditUnits,
        provenance: EngineProvenanceSchema.parse(workerResult.alignment.provenance),
      },
      diarization: {
        id: diarizationId,
        analysisRevisionId,
        audioSourceId: input.audioSource.id,
        sourceFingerprint: input.audioSource.fingerprint,
        turns: workerResult.diarization.turns.map((turn) => ({
          speakerId: speakerByLabel.get(turn.speakerLabel),
          audioSourceId: input.audioSource.id,
          sourceStart: turn.sourceStart,
          sourceEnd: turn.sourceEnd,
          confidence: turn.confidence,
        })),
        provenance: EngineProvenanceSchema.parse(workerResult.diarization.provenance),
      },
      speakers: attributed.speakers.map((speaker) => ({ ...speaker, analysisRevisionId })),
      speakerAttribution: {
        analysisRevisionId,
        alignmentArtifactId: alignmentId,
        diarizationArtifactId: diarizationId,
        attributions: attributed.attributions,
        provenance: {
          algorithmId: 'overlap-duration',
          algorithmVersion: '1',
          configHash: createHash('sha256').update('{}').digest('hex'),
          artifactSchemaVersion: 1,
          createdAt,
        },
      },
    })
  }
}
