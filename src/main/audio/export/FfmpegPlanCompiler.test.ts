import { expect, it } from 'vitest'
import type { AudioSourceId } from '@shared/ProjectTypes'
import { buildAudioRenderPlan } from '@shared/audio/AudioRenderPlanBuilder'
import { compileFfmpegPlan } from './FfmpegPlanCompiler'

it('renders a dry composite for the shared PCM leveler before manual gain and volume', () => {
  const sourceId = '00000000-0000-4000-8000-000000000001' as AudioSourceId
  const plan = buildAudioRenderPlan([], 'edited')
  plan.tracks = [
    {
      trackId: 'mix',
      volume: 0.5,
      gainDb: 6,
      normalize: { targetLufs: -16, truePeakDbtp: -1.5, loudnessRange: 7 },
      contributions: [sourceId, 'replacement' as AudioSourceId].map((audioSourceId) => ({
        clipId: audioSourceId,
        source: { audioSourceId, sourceStartFrame: 0, frameCount: 48000 },
        outputStartFrame: 0,
        gain: 1,
        envelope: { kind: 'constant' as const },
      })),
    },
  ]
  const graph = compileFfmpegPlan(
    plan,
    new Map([
      [sourceId, 0],
      ['replacement', 1],
    ]),
  )
  expect(graph).toContain(
    'amix=inputs=2:normalize=0:duration=longest,volume=1.9952623149688795,volume=0.5',
  )
  expect(graph).not.toMatch(/dynaudnorm|loudnorm/)
})
