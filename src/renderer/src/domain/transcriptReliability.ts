import type { RendererSpeechAnalysis } from '@shared/speech.types'

/** A timestamp alone does not establish that the source contains the claimed speech. */
export function hasValidatedTiming(analysis: RendererSpeechAnalysis): boolean {
  const validation = analysis.alignment.validation
  return validation?.version === 1 && validation.method === 'audio-evidence'
}
