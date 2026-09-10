import { describe, expect, it, vi } from 'vitest'
import { SpeechAnalysisCoordinator } from './SpeechAnalysisCoordinator'

const source = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  fingerprint: { byteLength: 42, modifiedTimeMs: 10, sha256: 'a'.repeat(64) },
}
const engine = {
  engineId: 'test',
  engineVersion: '1',
  modelId: 'model',
  configHash: 'b'.repeat(64),
  artifactSchemaVersion: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
}

describe('SpeechAnalysisCoordinator', () => {
  it('builds and validates one complete artifact in stage order', async () => {
    let id = 0
    const transcriber = {
      transcribe: vi.fn(async () => ({
        text: '觉得。',
        detectedLanguage: 'zh',
        verbatimCapability: 'best-effort-verbatim' as const,
        evidence: [{ text: '觉得。' }],
        provenance: engine,
      })),
    }
    const worker = {
      run: vi.fn(async (request, _signal, onProgress) => {
        onProgress?.({ stage: 'aligning', percent: 50 })
        onProgress?.({ stage: 'diarizing', percent: 50 })
        return {
          alignment: {
            units: [
              {
                transcriptUnitIds: request.transcriptUnits
                  .filter((unit: { kind: string }) => unit.kind === 'speech')
                  .map((unit: { id: string }) => unit.id),
                sourceStart: 0.75,
                sourceEnd: 1.18,
                granularity: 'phrase' as const,
              },
            ],
            unalignedTranscriptUnitIds: [],
            provenance: engine,
          },
          diarization: {
            turns: [{ speakerLabel: 'SPEAKER_00', sourceStart: 0.7, sourceEnd: 1.3 }],
            provenance: engine,
          },
        }
      }),
    }
    const stages: string[] = []
    const coordinator = new SpeechAnalysisCoordinator(
      transcriber,
      worker,
      () => `550e8400-e29b-41d4-a716-${String(++id).padStart(12, '0')}`,
    )
    const artifact = await coordinator.run(
      {
        jobId: 'job-1',
        audioPath: '/tmp/source.wav',
        audioSource: source,
        language: 'zh',
        alignmentModel: 'alignment-zh',
        diarizationModel: 'diarization-default',
      },
      new AbortController().signal,
      (progress) => stages.push(progress.stage),
    )

    expect(stages).toEqual([
      'transcribing',
      'aligning',
      'diarizing',
      'attributing-speakers',
      'validating',
    ])
    expect(artifact.transcript.units.map((unit) => [unit.text, unit.kind])).toEqual([
      ['觉', 'speech'],
      ['得', 'speech'],
      ['。', 'punctuation'],
    ])
    expect(artifact.alignment.acousticEditUnits[0].transcriptUnitIds).toHaveLength(2)
    expect(artifact.speakers[0].defaultDisplayName).toBe('Speaker 1')
  })

  it('does not invoke the worker when transcription is cancelled', async () => {
    const worker = { run: vi.fn() }
    const transcriber = {
      transcribe: vi.fn(async (_path, _options, signal: AbortSignal) => {
        signal.throwIfAborted()
        throw new DOMException('cancelled', 'AbortError')
      }),
    }
    const coordinator = new SpeechAnalysisCoordinator(transcriber, worker, crypto.randomUUID)
    const controller = new AbortController()
    controller.abort()
    await expect(
      coordinator.run(
        {
          jobId: 'job',
          audioPath: '/tmp/a.wav',
          audioSource: source,
          language: 'zh',
          alignmentModel: 'alignment-zh',
          diarizationModel: 'diarization-default',
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.run).not.toHaveBeenCalled()
  })
})
