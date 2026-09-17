import { z } from 'zod'
import type { AudioSourceId } from './source.types'

const action = z.enum(['skip', 'missing', 'replace'])
export const SpeechTaskSelectionSchema = z.object({ text: action, speakers: action }).strict()
export type SpeechTaskSelection = z.infer<typeof SpeechTaskSelectionSchema>
export interface SpeechSourceState {
  audioSourceId: AudioSourceId
  text: boolean
  speakers: boolean
}

/** Source-level policy shared by the task preview and the authoritative main-process plan. */
export function planSpeechTasks(
  sources: readonly SpeechSourceState[],
  selection: SpeechTaskSelection,
) {
  const unique = [...new Map(sources.map((source) => [source.audioSourceId, source])).values()]
  const text = unique
    .filter((source) => selection.text !== 'skip' && (selection.text === 'replace' || !source.text))
    .map((source) => source.audioSourceId)
  const speakers = unique
    .filter(
      (source) =>
        selection.speakers !== 'skip' &&
        (selection.speakers === 'replace' ||
          !source.speakers ||
          text.includes(source.audioSourceId)),
    )
    .map((source) => source.audioSourceId)
  const missingText = unique
    .filter(
      (source) =>
        speakers.includes(source.audioSourceId) &&
        !source.text &&
        !text.includes(source.audioSourceId),
    )
    .map((source) => source.audioSourceId)
  return { text, speakers, missingText }
}
