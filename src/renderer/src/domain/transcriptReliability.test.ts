import { expect, it } from 'vitest'
import { hasValidatedTiming } from './transcriptReliability'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
it('does not grant edit authority to legacy timestamps or unknown validation versions', () => {
  for (const validation of [undefined, { version: 2, method: 'audio-evidence' }])
    expect(
      hasValidatedTiming({ alignment: { validation } } as unknown as RendererSpeechAnalysis),
    ).toBe(false)
  expect(
    hasValidatedTiming({
      alignment: { validation: { version: 1, method: 'audio-evidence' } },
    } as unknown as RendererSpeechAnalysis),
  ).toBe(true)
})
