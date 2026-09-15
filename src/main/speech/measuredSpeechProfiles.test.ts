import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { SpeechStagePolicy } from './SpeechStagePolicy'
import { measuredSpeechProfiles, measuredSpeechConfiguration } from './measuredSpeechProfiles'

const revision = '3533c8cf8e369892e6b79ff1bf80f7b0286a54ee'
const context = {
  platform: 'darwin',
  architecture: 'arm64',
  cpuModels: Array.from({ length: 10 }, () => 'Apple M4'),
  device: 'cpu',
  modelPaths: { 'diarization-default': `/models/${revision}` },
  environment: {},
}
const policy = new SpeechStagePolicy(measuredSpeechProfiles)
function estimate(overrides: Partial<typeof context> = {}, seconds = 300) {
  return policy.forStage(
    'diarizing',
    seconds,
    measuredSpeechConfiguration({ ...context, ...overrides }),
  )
}
describe('measured diarization estimates', () => {
  it('uses conservative observations only within the measured 300–900 second range', () => {
    expect(estimate()).toEqual({ estimatedDurationMs: 324359 })
    expect(estimate({ environment: { OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4' } }, 900)).toEqual({
      estimatedDurationMs: 973076,
    })
    expect(estimate({}, 299)).toEqual({})
    expect(estimate({}, 901)).toEqual({})
    expect(policy.forStage('transcribing', 300, measuredSpeechConfiguration(context))).toEqual({})
    expect(policy.forStage('aligning', 300, measuredSpeechConfiguration(context))).toEqual({})
  })
  it.each([
    { platform: 'linux' },
    { architecture: 'x64' },
    { cpuModels: ['Apple M4 Pro'] },
    { cpuModels: [] },
    { cpuModels: ['Apple M4', 'Apple M3'] },
    { device: 'mps' },
    { modelPaths: { 'diarization-default': '/models/other-revision' } },
    { environment: { OMP_NUM_THREADS: '8' } },
    { environment: { MKL_NUM_THREADS: '1' } },
    { environment: { OPENBLAS_NUM_THREADS: '4' } },
    { environment: { VECLIB_MAXIMUM_THREADS: '4' } },
    { environment: { OMP_DYNAMIC: 'FALSE' } },
    { environment: { BLIS_NUM_THREADS: '4' } },
  ])('leaves unmatched configuration without an estimate: %j', (overrides) => {
    expect(estimate(overrides)).toEqual({})
  })
  it.each([1, 8, 9, 12])(
    'rejects an unmeasured Apple M4 topology with %i cores even with explicit four threads',
    (cores) => {
      const cpuModels = Array.from({ length: cores }, () => 'Apple M4')
      expect(estimate({ cpuModels })).toEqual({})
      expect(
        estimate({ cpuModels, environment: { OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4' } }),
      ).toEqual({})
    },
  )
  it('requires revalidation when the pinned inference dependencies change', () => {
    const dependencies = readFileSync('speech-worker/pyproject.toml', 'utf8')
    expect(dependencies).toContain('"pyannote-audio==4.0.7"')
    expect(dependencies).toContain('"torch==2.8.0"')
    expect(dependencies).toContain('"torchaudio==2.8.0"')
    expect(dependencies).toContain('"whisperx==3.8.6"')
  })
})
