import { describe, expect, it } from 'vitest'
import { SpeechWorkerRequestSchema, SpeechWorkerResponseSchema } from './speechWorker.types'

const request = {
  protocolVersion: 1,
  jobId: 'job-1',
  audioPath: '/tmp/source.wav',
  language: 'zh',
  transcriptUnits: [
    { id: '550e8400-e29b-41d4-a716-446655440001', text: '觉', kind: 'speech' },
    { id: '550e8400-e29b-41d4-a716-446655440002', text: '。', kind: 'punctuation' },
  ],
  models: { alignment: 'alignment-zh', diarization: 'diarization-default' },
  config: { device: 'cpu' },
}

describe('speech worker protocol', () => {
  it('accepts one strict versioned request without credential fields', () => {
    expect(SpeechWorkerRequestSchema.parse(request)).toEqual(request)
    expect(() => SpeechWorkerRequestSchema.parse({ ...request, hfToken: 'secret' })).toThrow()
    expect(() => SpeechWorkerRequestSchema.parse({ ...request, protocolVersion: 2 })).toThrow()
  })

  it('accepts correlated lifecycle messages and rejects malformed terminal results', () => {
    expect(
      SpeechWorkerResponseSchema.parse({ protocolVersion: 1, type: 'ready', jobId: 'job-1' }),
    ).toMatchObject({ type: 'ready' })
    expect(
      SpeechWorkerResponseSchema.parse({
        protocolVersion: 1,
        type: 'progress',
        jobId: 'job-1',
        stage: 'aligning',
        percent: 30,
      }),
    ).toMatchObject({ stage: 'aligning' })
    expect(() =>
      SpeechWorkerResponseSchema.parse({ protocolVersion: 1, type: 'result', jobId: 'job-1' }),
    ).toThrow()
    expect(() =>
      SpeechWorkerResponseSchema.parse({ protocolVersion: 1, type: 'mystery', jobId: 'job-1' }),
    ).toThrow()
  })
})

it('validates isolated requests and rejects mixed phase results', () => {
  const alignment = { ...request, phase: 'alignment', models: { alignment: 'alignment-en' } }
  expect(SpeechWorkerRequestSchema.safeParse(alignment).success).toBe(true)
  const diarization = {
    protocolVersion: 1,
    jobId: 'job',
    audioPath: '/a.wav',
    phase: 'diarization',
    models: { diarization: 'diarization-default' },
    config: { device: 'cpu' },
  }
  expect(SpeechWorkerRequestSchema.safeParse(diarization).success).toBe(true)
  expect(SpeechWorkerRequestSchema.safeParse({ ...diarization, transcriptUnits: [] }).success).toBe(
    false,
  )
  const envelope = { protocolVersion: 1, jobId: 'job', type: 'result' }
  const result = {
    phase: 'diarization',
    diarization: { status: 'completed', turns: [], provenance: {} },
  }
  expect(SpeechWorkerResponseSchema.safeParse({ ...envelope, result }).success).toBe(true)
  expect(
    SpeechWorkerResponseSchema.safeParse({
      ...envelope,
      result: {
        ...result,
        alignment: { units: [], unalignedTranscriptUnitIds: [], provenance: {} },
      },
    }).success,
  ).toBe(false)
  expect(
    SpeechWorkerResponseSchema.safeParse({ ...envelope, result: { phase: 'alignment' } }).success,
  ).toBe(false)
})

it('preserves audio validation through the worker protocol without trusting legacy output', () => {
  const legacy = {
    protocolVersion: 1,
    jobId: 'job',
    type: 'result',
    result: {
      phase: 'alignment',
      alignment: {
        units: [],
        unalignedTranscriptUnitIds: [],
        provenance: {},
      },
    },
  }
  expect(SpeechWorkerResponseSchema.parse(legacy)).toEqual(legacy)
  const validated = {
    ...legacy,
    result: {
      ...legacy.result,
      alignment: {
        ...legacy.result.alignment,
        validation: { version: 1, method: 'audio-evidence' },
      },
    },
  }
  expect(SpeechWorkerResponseSchema.parse(validated)).toEqual(validated)
})
