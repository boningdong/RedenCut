import { describe, expect, it } from 'vitest'
import { SpeechStagePolicy, type MeasuredStageProfile } from './SpeechStagePolicy'
const profile: MeasuredStageProfile = {
  stage: 'diarizing',
  configuration: 'model/device/cold',
  minimumAudioDurationSeconds: 300,
  maximumAudioDurationSeconds: 900,
  fixedOverheadMs: 2000,
  processingMsPerAudioSecond: 100,
  uncertaintyMultiplier: 1.2,
}
describe('speech stage policy', () => {
  it('leaves uncalibrated configurations and extrapolation without deadlines or estimates', () => {
    const policy = new SpeechStagePolicy([profile])
    expect(policy.forStage('aligning', 600, profile.configuration)).toEqual({})
    expect(policy.forStage('diarizing', 600, 'other-device')).toEqual({})
    expect(policy.forStage('diarizing', 3877, profile.configuration)).toEqual({})
    expect(new SpeechStagePolicy().forStage('diarizing', 600, profile.configuration)).toEqual({})
  })
  it('uses measured profiles only within their validated range', () => {
    expect(
      new SpeechStagePolicy([profile]).forStage('diarizing', 600, profile.configuration),
    ).toEqual({ estimatedDurationMs: 74400 })
  })
  it('rejects invalid measurements', () => {
    expect(
      new SpeechStagePolicy([{ ...profile, processingMsPerAudioSecond: NaN }]).forStage(
        'diarizing',
        600,
        profile.configuration,
      ),
    ).toEqual({})
  })
  it('retains stage timing beyond estimates and resets on transition without invented percentages', () => {
    let now = 1000
    const timing = new SpeechStagePolicy([profile]).createProgressTracker(
      600,
      profile.configuration,
      () => now,
    )
    expect(timing({ stage: 'preparing-audio' })).toEqual({
      stage: 'preparing-audio',
      stageStartedAtMs: 1000,
    })
    now = 2000
    expect(timing({ stage: 'diarizing', percent: 5 })).toEqual({
      stage: 'diarizing',
      percent: 5,
      stageStartedAtMs: 2000,
      estimatedDurationMs: 74400,
    })
    now = 10000000
    expect(timing({ stage: 'diarizing' })).toEqual({
      stage: 'diarizing',
      stageStartedAtMs: 2000,
      estimatedDurationMs: 74400,
    })
    expect(timing({ stage: 'publishing' })).toEqual({ stage: 'publishing', stageStartedAtMs: now })
  })
})

it('budgets the optional leading-silence probe separately from inference estimates', () => {
  const policy = new SpeechStagePolicy()
  expect(SpeechStagePolicy.leadingSilenceProbeBudgetMs).toBe(60000)
  expect(policy.forStage('transcribing', 3877.424, 'uncalibrated')).toEqual({})
})

it('keeps preparation timing when calibrated configuration becomes available later', () => {
  let configuration = 'unknown'
  let now = 1000
  const track = new SpeechStagePolicy([profile]).createProgressTracker(
    600,
    () => configuration,
    () => now,
  )
  expect(track({ stage: 'preparing-audio' }).stageStartedAtMs).toBe(1000)
  configuration = profile.configuration
  now = 2000
  expect(track({ stage: 'preparing-audio' }).stageStartedAtMs).toBe(1000)
  expect(track({ stage: 'diarizing' })).toMatchObject({
    stageStartedAtMs: 2000,
    estimatedDurationMs: 74400,
  })
})
