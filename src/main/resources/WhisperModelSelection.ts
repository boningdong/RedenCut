import type { ModelDefinition } from '../../shared/modelManifest.schema'

/** Preserve Small's original installation identity when older preferences omit selection. */
export function selectWhisperDefinition(
  models: readonly ModelDefinition[],
  id?: string,
): ModelDefinition | undefined {
  const candidates = models.filter((model) => model.capability === 'transcription')
  return (
    candidates.find((model) => model.id === id) ??
    candidates.find((model) => model.id === 'transcription-default') ??
    candidates[0]
  )
}
