import { describe, expect, it, vi } from 'vitest'
import type { ITranscriber } from '../../shared/transcriber.types'
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
        evidence: [{ text: '觉得。', sourceStart: 0.7, sourceEnd: 1.3 }],
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
            validation: { version: 1 as const, method: 'audio-evidence' as const },
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

    expect(worker.run.mock.calls[0][0]).toMatchObject({
      alignmentSegments: [{ text: '觉得。', sourceStart: 0.7, sourceEnd: 1.3 }],
    })
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
    expect(artifact.alignment).toMatchObject({
      validation: { version: 1, method: 'audio-evidence' },
    })
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
    const coordinator = new SpeechAnalysisCoordinator(transcriber, worker, () =>
      crypto.randomUUID(),
    )
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

describe('optional diarization', () => {
  const input = {
    jobId: 'job',
    audioPath: '/tmp/a.wav',
    audioSource: source,
    language: 'auto',
    alignmentModel: 'auto',
    diarizationModel: 'diarization-default',
    speakerRecognitionEnabled: false,
    modelPaths: { 'alignment-en': '/managed/en' },
  }
  function transcription(language = 'en') {
    return {
      text: 'hello',
      detectedLanguage: language,
      verbatimCapability: 'best-effort-verbatim' as const,
      evidence: [{ text: 'hello' }],
      provenance: engine,
    }
  }
  function alignment() {
    return { units: [], unalignedTranscriptUnitIds: [], provenance: engine }
  }
  it('forwards real recognition percentages before switching to alignment', async () => {
    const transcriber: Pick<ITranscriber, 'transcribe'> = {
      transcribe: async (_audio, _options, _signal, onProgress) => {
        onProgress?.({ stage: 'detecting-silence' })
        onProgress?.({ stage: 'transcribing', percent: 0 })
        onProgress?.({ stage: 'transcribing', percent: 42 })
        onProgress?.({ stage: 'transcribing', percent: 100 })
        onProgress?.({ stage: 'parsing-transcript' })
        return transcription()
      },
    }
    const worker = {
      run: vi.fn(async (_request, _signal, onProgress) => {
        onProgress?.({ stage: 'aligning', percent: 5 })
        return { alignment: alignment(), diarization: { status: 'skipped-disabled' as const } }
      }),
    }
    const progress = vi.fn()
    await new SpeechAnalysisCoordinator(transcriber, worker, () => crypto.randomUUID()).run(
      input,
      new AbortController().signal,
      progress,
    )
    expect(progress.mock.calls.map(([event]) => event)).toEqual([
      { stage: 'transcribing' },
      { stage: 'transcribing', percent: 0 },
      { stage: 'transcribing', percent: 42 },
      { stage: 'transcribing', percent: 100 },
      { stage: 'aligning', percent: 5 },
      { stage: 'validating' },
    ])
  })

  it('snapshots settings and returns no speaker data when disabled', async () => {
    const mutable = structuredClone(input)
    const transcriber = {
      transcribe: vi.fn(async () => {
        mutable.speakerRecognitionEnabled = true
        mutable.modelPaths['alignment-en'] = '/changed'
        return transcription()
      }),
    }
    const worker = {
      run: vi.fn(async () => ({
        alignment: alignment(),
        diarization: { status: 'skipped-disabled' as const },
      })),
    }
    const stages: string[] = []
    const result = await new SpeechAnalysisCoordinator(transcriber, worker, () =>
      crypto.randomUUID(),
    ).run(mutable, new AbortController().signal, (p) => stages.push(p.stage))
    expect(result).toMatchObject({
      schemaVersion: 2,
      diarizationStatus: 'skipped-disabled',
      speakers: [],
    })
    expect(result).not.toHaveProperty('diarization')
    expect(result).not.toHaveProperty('speakerAttribution')
    expect(stages).not.toContain('attributing-speakers')
    expect(vi.mocked(worker.run).mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          config: { device: 'cpu', speakerRecognitionEnabled: false },
          modelPaths: { 'alignment-en': '/managed/en' },
        }),
      ]),
    )
  })
  it('rejects unsupported language before alignment', async () => {
    const worker = { run: vi.fn() }
    const coordinator = new SpeechAnalysisCoordinator(
      { transcribe: async () => transcription('fr') },
      worker,
      () => crypto.randomUUID(),
    )
    await expect(coordinator.run(input, new AbortController().signal)).rejects.toMatchObject({
      reason: 'speech-language-unsupported',
    })
    expect(worker.run).not.toHaveBeenCalled()
  })
  it('rejects an unexpected skip rather than publishing it as success', async () => {
    const worker = {
      run: vi.fn(async () => ({
        alignment: alignment(),
        diarization: { status: 'skipped-disabled' as const },
      })),
    }
    const coordinator = new SpeechAnalysisCoordinator(
      { transcribe: async () => transcription() },
      worker,
      () => crypto.randomUUID(),
    )
    await expect(
      coordinator.run({ ...input, speakerRecognitionEnabled: true }, new AbortController().signal),
    ).rejects.toThrow('unexpected diarization branch')
  })
  it('keeps completed-with-no-speakers distinct from disabled', async () => {
    const worker = {
      run: vi.fn(async () => ({
        alignment: alignment(),
        diarization: { status: 'completed' as const, turns: [], provenance: engine },
      })),
    }
    const coordinator = new SpeechAnalysisCoordinator(
      { transcribe: async () => transcription() },
      worker,
      () => crypto.randomUUID(),
    )
    const result = await coordinator.run(
      { ...input, speakerRecognitionEnabled: true },
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      schemaVersion: 2,
      diarizationStatus: 'completed',
      diarization: { turns: [] },
      speakers: [],
    })
  })
})

it('publishes text before speakers and enriches without changing text identities', async () => {
  const transcriber = {
    transcribe: vi.fn(async () => ({
      text: 'hello',
      detectedLanguage: 'en',
      verbatimCapability: 'best-effort-verbatim' as const,
      evidence: [{ text: 'hello' }],
      provenance: engine,
    })),
  }
  const worker = {
    run: vi.fn(async (request) =>
      request.phase === 'alignment'
        ? {
            phase: 'alignment' as const,
            alignment: {
              units: [],
              unalignedTranscriptUnitIds: [],
              provenance: engine,
              validation: { version: 1 as const, method: 'audio-evidence' as const },
            },
          }
        : {
            phase: 'diarization' as const,
            diarization: { status: 'completed' as const, turns: [], provenance: engine },
          },
    ),
  }
  const coordinator = new SpeechAnalysisCoordinator(transcriber, worker, () => crypto.randomUUID())
  const input = {
    jobId: 'job',
    audioPath: '/tmp/a.wav',
    audioSource: source,
    language: 'en',
    alignmentModel: 'alignment-en',
    diarizationModel: 'diarization-default',
  }
  const signal = new AbortController().signal
  const pending = await coordinator.transcribeAndAlign(input, signal)
  expect(pending).toMatchObject({
    diarizationStatus: 'pending',
    speakers: [],
    alignment: { validation: { version: 1, method: 'audio-evidence' } },
  })
  expect(worker.run).toHaveBeenCalledTimes(1)
  const completed = await coordinator.identifySpeakers(input, pending, signal)
  expect(completed).toMatchObject({
    diarizationStatus: 'completed',
    analysisRevisionId: pending.analysisRevisionId,
    transcript: pending.transcript,
    alignment: pending.alignment,
  })
  expect(transcriber.transcribe).toHaveBeenCalledTimes(1)
  expect(worker.run.mock.calls[1][0]).toMatchObject({ phase: 'diarization' })
  expect(worker.run.mock.calls[1][0]).not.toHaveProperty('transcriptUnits')
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(
    coordinator.identifySpeakers(input, pending, cancelled.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  await expect(
    coordinator.identifySpeakers(
      {
        ...input,
        audioSource: { ...source, fingerprint: { ...source.fingerprint, sha256: 'c'.repeat(64) } },
      },
      pending,
      signal,
    ),
  ).rejects.toThrow('source does not match')
  expect(worker.run).toHaveBeenCalledTimes(2)
  expect(pending).toMatchObject({
    diarizationStatus: 'pending',
    speakers: [],
    alignment: { validation: { version: 1, method: 'audio-evidence' } },
  })
  const replaced = await coordinator.identifySpeakers(
    { ...input, replaceSpeakers: true },
    completed,
    signal,
  )
  expect(replaced.transcript).toEqual(completed.transcript)
  expect(replaced.alignment).toEqual(completed.alignment)
  expect(replaced.diarization?.id).not.toBe(completed.diarization?.id)
  expect(transcriber.transcribe).toHaveBeenCalledTimes(1)
  const legacyArtifact = {
    schemaVersion: 1 as const,
    analysisRevisionId: completed.analysisRevisionId,
    audioSourceId: completed.audioSourceId,
    sourceFingerprint: completed.sourceFingerprint,
    transcript: completed.transcript,
    alignment: completed.alignment,
    diarization: completed.diarization!,
    speakerAttribution: completed.speakerAttribution!,
    speakers: completed.speakers,
  }
  const legacyReplaced = await coordinator.identifySpeakers(
    { ...input, replaceSpeakers: true },
    legacyArtifact,
    signal,
  )
  expect(legacyReplaced.schemaVersion).toBe(2)
  expect(legacyReplaced.transcript).toEqual(completed.transcript)
  const disabled = await coordinator.transcribeAndAlign(
    { ...input, speakerRecognitionEnabled: false },
    signal,
  )
  expect(disabled).toMatchObject({ diarizationStatus: 'skipped-disabled', speakers: [] })
})
