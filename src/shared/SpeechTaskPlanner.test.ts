import { expect, it } from 'vitest'
import { planSpeechTasks } from './SpeechTaskPlanner'
import type { AudioSourceId } from './source.types'
const states = [
  { audioSourceId: 'A' as AudioSourceId, text: false, speakers: false },
  { audioSourceId: 'B' as AudioSourceId, text: true, speakers: false },
  { audioSourceId: 'C' as AudioSourceId, text: true, speakers: true },
]
it('deduplicates sources and skips each completed step independently', () => {
  expect(planSpeechTasks([...states, states[0]], { text: 'missing', speakers: 'missing' })).toEqual(
    { text: ['A'], speakers: ['A', 'B'], missingText: [] },
  )
})
it('recomputes speaker targets when the text is replaced', () => {
  expect(planSpeechTasks(states, { text: 'replace', speakers: 'missing' })).toEqual({
    text: ['A', 'B', 'C'],
    speakers: ['A', 'B', 'C'],
    missingText: [],
  })
})
it('reports a missing prerequisite without silently scheduling it', () => {
  expect(planSpeechTasks(states, { text: 'skip', speakers: 'missing' })).toEqual({
    text: [],
    speakers: ['A', 'B'],
    missingText: ['A'],
  })
})
